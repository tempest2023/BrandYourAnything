create table public.spots (
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

create table public.bids (
  id uuid primary key default gen_random_uuid(),
  spot_id smallint not null references public.spots(id),
  amount_cents bigint not null check (amount_cents > 0),
  bidder_name text not null check (char_length(bidder_name) between 1 and 80),
  bidder_email text not null check (char_length(bidder_email) between 3 and 254),
  website text check (website is null or char_length(website) <= 2048),
  x_handle text check (x_handle is null or char_length(x_handle) <= 50),
  logo_storage_path text,
  idempotency_key uuid not null unique,
  created_at timestamptz not null default clock_timestamp()
);

create index bids_spot_created_at_idx on public.bids (spot_id, created_at desc);
create index bids_created_at_idx on public.bids (created_at desc);

alter table public.spots enable row level security;
alter table public.bids enable row level security;

revoke all on table public.spots from anon, authenticated;
revoke all on table public.bids from anon, authenticated;
grant select, update on table public.spots to service_role;
grant select, insert on table public.bids to service_role;

insert into public.spots (
  id, name, size, dimensions, current_bid_cents, min_increment_cents,
  current_bidder_name, current_logo_url, current_website, bid_count, closes_at
)
values
  (1, 'Top left banner', 'L', '9.5 × 5.5 cm', 120000, 1000, 'Postiz', '/logos/postiz.png', 'https://postiz.io', 6, '2026-09-09T08:00:00Z'),
  (2, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', 171500, 1000, 'See.io', '/logos/see.png', 'https://see.io', 3, '2026-09-09T08:00:00Z'),
  (3, 'Top right banner', 'L', '9.5 × 5.5 cm', 101000, 1000, 'PrivateAlps', '/logos/privatealps.png', 'https://privatealps.net', 19, '2026-09-09T08:00:00Z'),
  (4, 'Middle left', 'S', '4.5 × 4.5 cm', 37500, 1000, 'Draftline Fantasy', '/logos/draftline.svg', 'https://www.draftlinefantasy.com', 17, '2026-09-09T08:00:00Z'),
  (5, 'Inner left — beside the logo', 'S', '4.5 × 4.5 cm', 41000, 1000, 'Surf Office', '/logos/surfoffice.png', 'https://www.surfoffice.com', 12, '2026-09-09T08:00:00Z'),
  (6, 'Inner right — beside the logo', 'S', '4.5 × 4.5 cm', 37700, 1000, 'emma.pet', '/logos/emma.png', 'https://emma.pet', 12, '2026-09-09T08:00:00Z'),
  (7, 'Middle right', 'S', '4.5 × 4.5 cm', 37000, 1000, 'Moyai', '/logos/moyai.png', 'https://moyai.ai', 11, '2026-09-09T08:00:00Z'),
  (8, 'Bottom left strip', 'M', '9.5 × 4 cm', 66600, 1000, 'VedicAstrology.com', '/logos/vedic.png', 'https://vedicastrology.com', 13, '2026-09-09T08:00:00Z'),
  (9, 'Bottom center — under the logo', 'M', '9.5 × 4 cm', 71000, 1000, 'Felyn GO', '/logos/felyn.jpg', null, 16, '2026-09-09T08:00:00Z'),
  (10, 'Bottom right strip', 'M', '9.5 × 4 cm', 50000, 1000, 'Clipory', '/logos/clipory.svg', 'https://clipory.app', 14, '2026-09-09T08:00:00Z');

insert into public.bids (
  id, spot_id, amount_cents, bidder_name, bidder_email, website,
  idempotency_key, created_at
)
values
  ('10000000-0000-4000-8000-000000000001', 2, 171500, 'See.io', 'legacy+see@brandmymac.invalid', 'https://see.io', '20000000-0000-4000-8000-000000000001', now() - interval '18 minutes'),
  ('10000000-0000-4000-8000-000000000002', 3, 101000, 'PrivateAlps', 'legacy+privatealps@brandmymac.invalid', 'https://privatealps.net', '20000000-0000-4000-8000-000000000002', now() - interval '34 minutes'),
  ('10000000-0000-4000-8000-000000000003', 1, 120000, 'Postiz', 'legacy+postiz@brandmymac.invalid', 'https://postiz.io', '20000000-0000-4000-8000-000000000003', now() - interval '1 hour'),
  ('10000000-0000-4000-8000-000000000004', 9, 71000, 'Felyn GO', 'legacy+felyn@brandmymac.invalid', null, '20000000-0000-4000-8000-000000000004', now() - interval '2 hours'),
  ('10000000-0000-4000-8000-000000000005', 8, 66600, 'VedicAstrology.com', 'legacy+vedic@brandmymac.invalid', 'https://vedicastrology.com', '20000000-0000-4000-8000-000000000005', now() - interval '3 hours'),
  ('10000000-0000-4000-8000-000000000006', 10, 50000, 'Clipory', 'legacy+clipory@brandmymac.invalid', 'https://clipory.app', '20000000-0000-4000-8000-000000000006', now() - interval '4 hours'),
  ('10000000-0000-4000-8000-000000000007', 5, 41000, 'Surf Office', 'legacy+surfoffice@brandmymac.invalid', 'https://www.surfoffice.com', '20000000-0000-4000-8000-000000000007', now() - interval '5 hours'),
  ('10000000-0000-4000-8000-000000000008', 6, 37700, 'emma.pet', 'legacy+emma@brandmymac.invalid', 'https://emma.pet', '20000000-0000-4000-8000-000000000008', now() - interval '6 hours');

create or replace function public.place_bid(
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
  v_spot public.spots%rowtype;
  v_existing public.bids%rowtype;
  v_bid_id uuid;
  v_bidder_name text := trim(p_bidder_name);
  v_bidder_email text := lower(trim(p_bidder_email));
begin
  if p_amount_cents < 1000 or p_amount_cents > 100000000 then
    raise exception 'Bid amount is outside the allowed range.' using errcode = '22023';
  end if;
  if char_length(v_bidder_name) not between 1 and 80 then
    raise exception 'Bidder name is invalid.' using errcode = '22023';
  end if;
  if char_length(v_bidder_email) not between 3 and 254 then
    raise exception 'Bidder email is invalid.' using errcode = '22023';
  end if;

  -- Serialize retries for the same idempotency key, including accidental use
  -- across different spots, before taking the per-spot price lock.
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(p_idempotency_key::text, 0)
  );

  -- This row lock is the concurrency boundary. Competing bids for different
  -- spots proceed independently; bids for the same spot wait, then re-check
  -- the latest committed price before writing.
  select *
  into v_spot
  from public.spots
  where public.spots.id = p_spot_id
  for update;

  if not found then
    raise exception 'Sticker spot does not exist.' using errcode = '22023';
  end if;

  select *
  into v_existing
  from public.bids
  where public.bids.idempotency_key = p_idempotency_key;

  if found then
    if v_existing.spot_id = p_spot_id
      and v_existing.amount_cents = p_amount_cents
      and v_existing.bidder_name = v_bidder_name
      and v_existing.bidder_email = v_bidder_email
      and v_existing.website is not distinct from nullif(trim(p_website), '')
      and v_existing.x_handle is not distinct from nullif(trim(p_x_handle), '')
      and v_existing.logo_storage_path is not distinct from nullif(trim(p_logo_storage_path), '') then
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

  insert into public.bids (
    spot_id, amount_cents, bidder_name, bidder_email, website,
    x_handle, logo_storage_path, idempotency_key
  )
  values (
    p_spot_id, p_amount_cents, v_bidder_name, v_bidder_email,
    nullif(trim(p_website), ''), nullif(trim(p_x_handle), ''),
    nullif(trim(p_logo_storage_path), ''), p_idempotency_key
  )
  returning public.bids.id into v_bid_id;

  update public.spots
  set
    current_bid_cents = p_amount_cents,
    current_bidder_name = v_bidder_name,
    current_logo_url = null,
    current_website = nullif(trim(p_website), ''),
    bid_count = public.spots.bid_count + 1,
    updated_at = clock_timestamp()
  where public.spots.id = p_spot_id;

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

revoke execute on function public.place_bid(smallint, bigint, text, text, text, text, text, uuid) from public, anon, authenticated;
grant execute on function public.place_bid(smallint, bigint, text, text, text, text, text, uuid) to service_role;

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'bid-logos',
  'bid-logos',
  false,
  2097152,
  array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update set
  public = excluded.public,
  file_size_limit = excluded.file_size_limit,
  allowed_mime_types = excluded.allowed_mime_types;
