-- Brand Anything shares a Supabase project with other applications. Every
-- database object is prefixed with ba_<environment>_ to keep projects and
-- development data isolated without adding environment columns everywhere.

create table public.ba_dev_spots (
  id smallint primary key,
  name text not null,
  size text not null check (size in ('S', 'M', 'L')),
  dimensions text not null,
  current_bid_cents bigint not null check (current_bid_cents >= 0),
  min_increment_cents integer not null default 1000 check (min_increment_cents > 0),
  current_bidder_name text not null,
  current_logo_url text,
  current_website text,
  bid_count integer not null default 0 check (bid_count >= 0),
  closes_at timestamptz not null,
  updated_at timestamptz not null default now()
);

create table public.ba_prod_spots (
  like public.ba_dev_spots including all
);

create table public.ba_dev_bids (
  id uuid primary key default gen_random_uuid(),
  spot_id smallint not null references public.ba_dev_spots(id),
  amount_cents bigint not null check (amount_cents > 0),
  bidder_name text not null check (char_length(bidder_name) between 1 and 80),
  bidder_email text not null check (char_length(bidder_email) between 3 and 254),
  website text check (website is null or char_length(website) <= 2048),
  x_handle text check (x_handle is null or char_length(x_handle) <= 50),
  logo_storage_path text,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create table public.ba_prod_bids (
  like public.ba_dev_bids including all,
  constraint ba_prod_bids_spot_id_fkey
    foreign key (spot_id) references public.ba_prod_spots(id)
);

create index ba_dev_bids_spot_created_at_idx
  on public.ba_dev_bids (spot_id, created_at desc);
create index ba_dev_bids_created_at_idx
  on public.ba_dev_bids (created_at desc);
create index ba_prod_bids_spot_created_at_idx
  on public.ba_prod_bids (spot_id, created_at desc);
create index ba_prod_bids_created_at_idx
  on public.ba_prod_bids (created_at desc);

alter table public.ba_dev_spots enable row level security;
alter table public.ba_dev_bids enable row level security;
alter table public.ba_prod_spots enable row level security;
alter table public.ba_prod_bids enable row level security;

revoke all on table public.ba_dev_spots from anon, authenticated;
revoke all on table public.ba_dev_bids from anon, authenticated;
revoke all on table public.ba_prod_spots from anon, authenticated;
revoke all on table public.ba_prod_bids from anon, authenticated;
grant select, update on table public.ba_dev_spots to service_role;
grant select, insert on table public.ba_dev_bids to service_role;
grant select, update on table public.ba_prod_spots to service_role;
grant select, insert on table public.ba_prod_bids to service_role;

insert into public.ba_dev_spots (
  id, name, size, dimensions, current_bid_cents, min_increment_cents,
  current_bidder_name, current_logo_url, current_website, bid_count, closes_at
)
values
  -- current_bid_cents starts one $10 increment below the opening price so the
  -- existing atomic bid function enforces $400 / $200 / $125 first bids.
  (1, 'Top left banner', 'L', '9.5 × 5.5 cm', 39000, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (2, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', 39000, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (3, 'Top right banner', 'L', '9.5 × 5.5 cm', 39000, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (4, 'Middle left', 'S', '4.5 × 4.5 cm', 11500, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (5, 'Inner left — beside the logo', 'S', '4.5 × 4.5 cm', 11500, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (6, 'Inner right — beside the logo', 'S', '4.5 × 4.5 cm', 11500, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (7, 'Middle right', 'S', '4.5 × 4.5 cm', 11500, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (8, 'Bottom left strip', 'M', '9.5 × 4 cm', 19000, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (9, 'Bottom center — under the logo', 'M', '9.5 × 4 cm', 19000, 1000, '', null, null, 0, '2026-09-09T08:00:00Z'),
  (10, 'Bottom right strip', 'M', '9.5 × 4 cm', 19000, 1000, '', null, null, 0, '2026-09-09T08:00:00Z');

insert into public.ba_prod_spots
select * from public.ba_dev_spots;

create or replace function public.ba_place_bid_internal(
  p_environment text,
  p_spot_id smallint,
  p_amount_cents bigint,
  p_bidder_name text,
  p_bidder_email text,
  p_website text,
  p_x_handle text,
  p_logo_storage_path text,
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  reason text,
  current_bid_cents bigint,
  minimum_next_bid_cents bigint,
  current_bidder_name text,
  bid_count integer,
  bid_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_spot public.ba_dev_spots%rowtype;
  v_existing public.ba_dev_bids%rowtype;
  v_bid_id uuid;
  v_bidder_name text := trim(p_bidder_name);
  v_bidder_email text := lower(trim(p_bidder_email));
  v_website text := nullif(trim(p_website), '');
  v_x_handle text := nullif(trim(p_x_handle), '');
  v_logo_storage_path text := nullif(trim(p_logo_storage_path), '');
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'Auction environment is invalid.' using errcode = '22023';
  end if;

  if p_amount_cents < 1000 or p_amount_cents > 100000000 then
    raise exception 'Bid amount is outside the allowed range.' using errcode = '22023';
  end if;
  if char_length(v_bidder_name) not between 1 and 80 then
    raise exception 'Bidder name is invalid.' using errcode = '22023';
  end if;
  if char_length(v_bidder_email) not between 3 and 254 then
    raise exception 'Bidder email is invalid.' using errcode = '22023';
  end if;

  -- Include the environment in the lock key so dev retries never serialize
  -- production traffic that happens to use the same UUID.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ba:' || p_environment || ':' || p_idempotency_key::text,
      0
    )
  );

  -- This row lock is the concurrency boundary. Same-spot bids wait here and
  -- re-check the latest committed price; bids for other spots proceed freely.
  if p_environment = 'dev' then
    select *
    into v_spot
    from public.ba_dev_spots
    where public.ba_dev_spots.id = p_spot_id
    for update;
  else
    select *
    into v_spot
    from public.ba_prod_spots
    where public.ba_prod_spots.id = p_spot_id
    for update;
  end if;

  if not found then
    raise exception 'Sticker spot does not exist.' using errcode = '22023';
  end if;

  if p_environment = 'dev' then
    select *
    into v_existing
    from public.ba_dev_bids
    where public.ba_dev_bids.idempotency_key = p_idempotency_key;
  else
    select *
    into v_existing
    from public.ba_prod_bids
    where public.ba_prod_bids.idempotency_key = p_idempotency_key;
  end if;

  if found then
    if v_existing.spot_id = p_spot_id
      and v_existing.amount_cents = p_amount_cents
      and v_existing.bidder_name = v_bidder_name
      and v_existing.bidder_email = v_bidder_email
      and v_existing.website is not distinct from v_website
      and v_existing.x_handle is not distinct from v_x_handle
      and v_existing.logo_storage_path is not distinct from v_logo_storage_path then
      return query select
        true,
        'already_processed'::text,
        v_spot.current_bid_cents,
        v_spot.current_bid_cents + v_spot.min_increment_cents,
        v_spot.current_bidder_name,
        v_spot.bid_count,
        v_existing.id;
    else
      return query select
        false,
        'idempotency_conflict'::text,
        v_spot.current_bid_cents,
        v_spot.current_bid_cents + v_spot.min_increment_cents,
        v_spot.current_bidder_name,
        v_spot.bid_count,
        null::uuid;
    end if;
    return;
  end if;

  if clock_timestamp() >= v_spot.closes_at then
    return query select
      false,
      'auction_closed'::text,
      v_spot.current_bid_cents,
      v_spot.current_bid_cents + v_spot.min_increment_cents,
      v_spot.current_bidder_name,
      v_spot.bid_count,
      null::uuid;
    return;
  end if;

  if p_amount_cents < v_spot.current_bid_cents + v_spot.min_increment_cents then
    return query select
      false,
      'bid_too_low'::text,
      v_spot.current_bid_cents,
      v_spot.current_bid_cents + v_spot.min_increment_cents,
      v_spot.current_bidder_name,
      v_spot.bid_count,
      null::uuid;
    return;
  end if;

  if p_environment = 'dev' then
    insert into public.ba_dev_bids (
      spot_id, amount_cents, bidder_name, bidder_email, website,
      x_handle, logo_storage_path, idempotency_key
    )
    values (
      p_spot_id, p_amount_cents, v_bidder_name, v_bidder_email,
      v_website, v_x_handle, v_logo_storage_path, p_idempotency_key
    )
    returning public.ba_dev_bids.id into v_bid_id;

    update public.ba_dev_spots
    set
      current_bid_cents = p_amount_cents,
      current_bidder_name = v_bidder_name,
      current_logo_url = null,
      current_website = v_website,
      bid_count = public.ba_dev_spots.bid_count + 1,
      updated_at = clock_timestamp()
    where public.ba_dev_spots.id = p_spot_id;
  else
    insert into public.ba_prod_bids (
      spot_id, amount_cents, bidder_name, bidder_email, website,
      x_handle, logo_storage_path, idempotency_key
    )
    values (
      p_spot_id, p_amount_cents, v_bidder_name, v_bidder_email,
      v_website, v_x_handle, v_logo_storage_path, p_idempotency_key
    )
    returning public.ba_prod_bids.id into v_bid_id;

    update public.ba_prod_spots
    set
      current_bid_cents = p_amount_cents,
      current_bidder_name = v_bidder_name,
      current_logo_url = null,
      current_website = v_website,
      bid_count = public.ba_prod_spots.bid_count + 1,
      updated_at = clock_timestamp()
    where public.ba_prod_spots.id = p_spot_id;
  end if;

  return query select
    true,
    'accepted'::text,
    p_amount_cents,
    p_amount_cents + v_spot.min_increment_cents,
    v_bidder_name,
    v_spot.bid_count + 1,
    v_bid_id;
end;
$$;

revoke execute on function public.ba_place_bid_internal(
  text, smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated, service_role;

create or replace function public.ba_dev_place_bid(
  p_spot_id smallint,
  p_amount_cents bigint,
  p_bidder_name text,
  p_bidder_email text,
  p_website text,
  p_x_handle text,
  p_logo_storage_path text,
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  reason text,
  current_bid_cents bigint,
  minimum_next_bid_cents bigint,
  current_bidder_name text,
  bid_count integer,
  bid_id uuid
)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_place_bid_internal(
    'dev', p_spot_id, p_amount_cents, p_bidder_name, p_bidder_email,
    p_website, p_x_handle, p_logo_storage_path, p_idempotency_key
  );
$$;

create or replace function public.ba_prod_place_bid(
  p_spot_id smallint,
  p_amount_cents bigint,
  p_bidder_name text,
  p_bidder_email text,
  p_website text,
  p_x_handle text,
  p_logo_storage_path text,
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  reason text,
  current_bid_cents bigint,
  minimum_next_bid_cents bigint,
  current_bidder_name text,
  bid_count integer,
  bid_id uuid
)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_place_bid_internal(
    'prod', p_spot_id, p_amount_cents, p_bidder_name, p_bidder_email,
    p_website, p_x_handle, p_logo_storage_path, p_idempotency_key
  );
$$;

revoke execute on function public.ba_dev_place_bid(
  smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_place_bid(
  smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;
grant execute on function public.ba_dev_place_bid(
  smallint, bigint, text, text, text, text, text, uuid
) to service_role;
grant execute on function public.ba_prod_place_bid(
  smallint, bigint, text, text, text, text, text, uuid
) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values
  (
    'ba_dev_bid_logos',
    'ba_dev_bid_logos',
    false,
    2097152,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  ),
  (
    'ba_prod_bid_logos',
    'ba_prod_bid_logos',
    false,
    2097152,
    array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
  )
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
