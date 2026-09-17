-- PR18's ownership flow now sits behind the auction API. The underlying
-- tables retain laptop names for backwards compatibility, but the generic
-- creation function was renamed in the auction RPC migration. Repoint the
-- ownership wrapper so authenticated auction publishing remains atomic.

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
returns table (accepted boolean, reason text, laptop_id uuid, laptop_slug text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_result record;
  v_owner_user_id uuid;
  v_manager_key_hash text;
begin
  if (p_owner_user_id is null) = (p_manager_key_hash is null) then
    raise exception 'Exactly one auction owner credential is required.' using errcode = '22023';
  end if;
  if p_manager_key_hash is not null and p_manager_key_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Auction manager key hash is invalid.' using errcode = '22023';
  end if;

  select * into v_result
  from public.ba_create_auction_internal(
    p_environment, p_slug, p_owner_name, p_owner_email, p_title, p_tagline,
    p_story, p_laptop_model, p_goal_cents, p_auction_closes_at,
    p_photo_storage_path, p_small_opening_bid_cents,
    p_medium_opening_bid_cents, p_large_opening_bid_cents,
    p_min_increment_cents, p_idempotency_key
  );

  if not v_result.accepted or v_result.laptop_id is null then
    return query select v_result.accepted, v_result.reason::text,
      v_result.laptop_id::uuid, v_result.laptop_slug::text;
    return;
  end if;

  if p_environment = 'dev' then
    select owner_user_id, manager_key_hash into v_owner_user_id, v_manager_key_hash
    from public.ba_dev_laptops where id = v_result.laptop_id for update;
  else
    select owner_user_id, manager_key_hash into v_owner_user_id, v_manager_key_hash
    from public.ba_prod_laptops where id = v_result.laptop_id for update;
  end if;

  if v_owner_user_id is null and v_manager_key_hash is null then
    if p_environment = 'dev' then
      update public.ba_dev_laptops set owner_user_id = p_owner_user_id,
        manager_key_hash = p_manager_key_hash, updated_at = clock_timestamp()
      where id = v_result.laptop_id;
    else
      update public.ba_prod_laptops set owner_user_id = p_owner_user_id,
        manager_key_hash = p_manager_key_hash, updated_at = clock_timestamp()
      where id = v_result.laptop_id;
    end if;
  elsif not (
    (p_owner_user_id is not null and v_owner_user_id = p_owner_user_id)
    or (p_manager_key_hash is not null and v_manager_key_hash in (p_manager_key_hash, left(p_manager_key_hash, 32)))
  ) then
    return query select false, 'idempotency_conflict'::text, null::uuid, v_result.laptop_slug::text;
    return;
  end if;

  return query select true, v_result.reason::text, v_result.laptop_id::uuid, v_result.laptop_slug::text;
end;
$$;
