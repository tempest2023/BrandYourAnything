-- Hybrid ownership for account-backed and accountless auctions.
-- X owners are bound by auth.users.id. Browser owners are bound by a
-- per-auction recovery-code hash; the raw recovery code never reaches storage.

alter table public.ba_dev_laptops
  add column owner_user_id uuid references auth.users(id) on delete set null,
  add column manager_key_hash text
    check (manager_key_hash is null or manager_key_hash ~ '^[0-9a-f]{32}([0-9a-f]{32})?$');

alter table public.ba_prod_laptops
  add column owner_user_id uuid references auth.users(id) on delete set null,
  add column manager_key_hash text
    check (manager_key_hash is null or manager_key_hash ~ '^[0-9a-f]{32}([0-9a-f]{32})?$');

-- Preserve ownership of auctions created by the original browser-key flow.
update public.ba_dev_laptops
set manager_key_hash = substring(owner_email from '^lid-([0-9a-f]{32})@auth[.]brand-anything[.]vercel[.]app$')
where owner_email ~ '^lid-[0-9a-f]{32}@auth[.]brand-anything[.]vercel[.]app$';

update public.ba_prod_laptops
set manager_key_hash = substring(owner_email from '^lid-([0-9a-f]{32})@auth[.]brand-anything[.]vercel[.]app$')
where owner_email ~ '^lid-[0-9a-f]{32}@auth[.]brand-anything[.]vercel[.]app$';

create index ba_dev_laptops_owner_user_idx
  on public.ba_dev_laptops (owner_user_id, created_at desc)
  where owner_user_id is not null;
create index ba_prod_laptops_owner_user_idx
  on public.ba_prod_laptops (owner_user_id, created_at desc)
  where owner_user_id is not null;
create index ba_dev_laptops_manager_key_idx
  on public.ba_dev_laptops (manager_key_hash)
  where manager_key_hash is not null;
create index ba_prod_laptops_manager_key_idx
  on public.ba_prod_laptops (manager_key_hash)
  where manager_key_hash is not null;

create or replace function public.ba_create_owned_laptop_internal(
  p_environment text,
  p_slug text,
  p_owner_user_id uuid,
  p_manager_key_hash text,
  p_owner_name text,
  p_owner_email text,
  p_title text,
  p_tagline text,
  p_story text,
  p_laptop_model text,
  p_goal_cents bigint,
  p_auction_closes_at timestamptz,
  p_photo_storage_path text,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  reason text,
  laptop_id uuid,
  laptop_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
  v_stored_user_id uuid;
  v_stored_manager_hash text;
begin
  if (p_owner_user_id is null) = (p_manager_key_hash is null) then
    raise exception 'Exactly one auction owner credential is required.' using errcode = '22023';
  end if;
  if p_manager_key_hash is not null and p_manager_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Auction manager key hash is invalid.' using errcode = '22023';
  end if;

  select * into v_result
  from public.ba_create_laptop_internal(
    p_environment, p_slug, p_owner_name, p_owner_email, p_title, p_tagline,
    p_story, p_laptop_model, p_goal_cents, p_auction_closes_at,
    p_photo_storage_path, p_small_opening_bid_cents,
    p_medium_opening_bid_cents, p_large_opening_bid_cents,
    p_min_increment_cents, p_idempotency_key
  );

  if not v_result.accepted or v_result.laptop_id is null then
    return query select v_result.accepted, v_result.reason, v_result.laptop_id, v_result.laptop_slug;
    return;
  end if;

  if p_environment = 'dev' then
    select owner_user_id, manager_key_hash
      into v_stored_user_id, v_stored_manager_hash
    from public.ba_dev_laptops where id = v_result.laptop_id for update;
  else
    select owner_user_id, manager_key_hash
      into v_stored_user_id, v_stored_manager_hash
    from public.ba_prod_laptops where id = v_result.laptop_id for update;
  end if;

  if v_stored_user_id is null and v_stored_manager_hash is null then
    if p_environment = 'dev' then
      update public.ba_dev_laptops
      set owner_user_id = p_owner_user_id,
          manager_key_hash = p_manager_key_hash,
          updated_at = clock_timestamp()
      where id = v_result.laptop_id;
    else
      update public.ba_prod_laptops
      set owner_user_id = p_owner_user_id,
          manager_key_hash = p_manager_key_hash,
          updated_at = clock_timestamp()
      where id = v_result.laptop_id;
    end if;
  elsif not (
    (p_owner_user_id is not null and v_stored_user_id = p_owner_user_id)
    or (p_manager_key_hash is not null and v_stored_manager_hash in (p_manager_key_hash, left(p_manager_key_hash, 32)))
  ) then
    return query select false, 'idempotency_conflict'::text, null::uuid, v_result.laptop_slug;
    return;
  end if;

  return query select true, v_result.reason::text, v_result.laptop_id::uuid, v_result.laptop_slug::text;
end;
$$;

create or replace function public.ba_dev_create_owned_laptop(
  p_slug text,
  p_owner_user_id uuid,
  p_manager_key_hash text,
  p_owner_name text,
  p_owner_email text,
  p_title text,
  p_tagline text,
  p_story text,
  p_laptop_model text,
  p_goal_cents bigint,
  p_auction_closes_at timestamptz,
  p_photo_storage_path text,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns table (accepted boolean, reason text, laptop_id uuid, laptop_slug text)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_create_owned_laptop_internal(
    'dev', p_slug, p_owner_user_id, p_manager_key_hash, p_owner_name,
    p_owner_email, p_title, p_tagline, p_story, p_laptop_model,
    p_goal_cents, p_auction_closes_at, p_photo_storage_path,
    p_small_opening_bid_cents, p_medium_opening_bid_cents,
    p_large_opening_bid_cents, p_min_increment_cents, p_idempotency_key
  );
$$;

create or replace function public.ba_prod_create_owned_laptop(
  p_slug text,
  p_owner_user_id uuid,
  p_manager_key_hash text,
  p_owner_name text,
  p_owner_email text,
  p_title text,
  p_tagline text,
  p_story text,
  p_laptop_model text,
  p_goal_cents bigint,
  p_auction_closes_at timestamptz,
  p_photo_storage_path text,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns table (accepted boolean, reason text, laptop_id uuid, laptop_slug text)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_create_owned_laptop_internal(
    'prod', p_slug, p_owner_user_id, p_manager_key_hash, p_owner_name,
    p_owner_email, p_title, p_tagline, p_story, p_laptop_model,
    p_goal_cents, p_auction_closes_at, p_photo_storage_path,
    p_small_opening_bid_cents, p_medium_opening_bid_cents,
    p_large_opening_bid_cents, p_min_increment_cents, p_idempotency_key
  );
$$;

revoke all on function public.ba_create_owned_laptop_internal(
  text, text, uuid, text, text, text, text, text, text, text, bigint,
  timestamptz, text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.ba_dev_create_owned_laptop(
  text, uuid, text, text, text, text, text, text, text, bigint,
  timestamptz, text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke all on function public.ba_prod_create_owned_laptop(
  text, uuid, text, text, text, text, text, text, text, bigint,
  timestamptz, text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;

grant execute on function public.ba_dev_create_owned_laptop(
  text, uuid, text, text, text, text, text, text, text, bigint,
  timestamptz, text, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_prod_create_owned_laptop(
  text, uuid, text, text, text, text, text, text, text, bigint,
  timestamptz, text, bigint, bigint, bigint, integer, uuid
) to service_role;
