-- Publication is one transaction: owner + auction + spots + asset.
-- The immutable request survives retries even after close/model repair.
alter table public.ba_dev_laptops add column publish_parameters jsonb;
alter table public.ba_prod_laptops add column publish_parameters jsonb;

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
    coalesce(p_owner_user_id is not null and v_owner_user_id = p_owner_user_id, false)
    or coalesce(p_manager_key_hash is not null and v_manager_key_hash in (p_manager_key_hash, left(p_manager_key_hash, 32)), false)
  ) then
    return query select false, 'idempotency_conflict'::text, null::uuid, v_result.laptop_slug::text;
    return;
  end if;

  return query select true, v_result.reason::text, v_result.laptop_id::uuid, v_result.laptop_slug::text;
end;
$$;

-- Only complete legacy publications have enough evidence for an exact retry.
-- Incomplete legacy rows are not silently repaired/reassigned by publishing.
update public.ba_dev_laptops a set publish_parameters = jsonb_build_object(
  'slug', a.slug, 'title', a.title, 'tagline', a.tagline, 'story', a.story,
  'objectName', a.laptop_model, 'goalCents', a.goal_cents,
  'auctionClosesAt', a.auction_closes_at, 'photoStoragePath', a.photo_storage_path,
  'smallOpeningBidCents', a.small_opening_bid_cents,
  'mediumOpeningBidCents', a.medium_opening_bid_cents,
  'largeOpeningBidCents', a.large_opening_bid_cents, 'minIncrementCents', a.min_increment_cents,
  'spotLayout', a.spot_layout, 'idempotencyKey', a.idempotency_key,
  'assetType', b.asset_type, 'assetName', b.asset_name,
  'modelStoragePath', b.model_storage_path, 'modelFileName', b.model_file_name
) from public.ba_dev_campaign_assets b
where b.laptop_id = a.id and b.idempotency_key = a.idempotency_key and a.spot_layout is not null;

-- Only complete legacy publications have enough evidence for an exact retry.
-- Incomplete legacy rows are not silently repaired/reassigned by publishing.
update public.ba_prod_laptops a set publish_parameters = jsonb_build_object(
  'slug', a.slug, 'title', a.title, 'tagline', a.tagline, 'story', a.story,
  'objectName', a.laptop_model, 'goalCents', a.goal_cents,
  'auctionClosesAt', a.auction_closes_at, 'photoStoragePath', a.photo_storage_path,
  'smallOpeningBidCents', a.small_opening_bid_cents,
  'mediumOpeningBidCents', a.medium_opening_bid_cents,
  'largeOpeningBidCents', a.large_opening_bid_cents, 'minIncrementCents', a.min_increment_cents,
  'spotLayout', a.spot_layout, 'idempotencyKey', a.idempotency_key,
  'assetType', b.asset_type, 'assetName', b.asset_name,
  'modelStoragePath', b.model_storage_path, 'modelFileName', b.model_file_name
) from public.ba_prod_campaign_assets b
where b.laptop_id = a.id and b.idempotency_key = a.idempotency_key and a.spot_layout is not null;

create or replace function public.ba_publish_owned_auction_internal(
  p_environment text, p_owner_user_id uuid, p_manager_key_hash text, p_input jsonb
) returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language plpgsql security definer set search_path = ''
as $$
declare
  v_table text;
  v_asset_table text;
  v_existing record;
  v_result record;
  v_parameters jsonb;
  v_key uuid := (p_input ->> 'idempotencyKey')::uuid;
  v_slug text := p_input ->> 'slug';
begin
  if p_environment is null or p_environment not in ('dev', 'prod')
    or jsonb_typeof(p_input) is distinct from 'object' or v_key is null then
    raise exception 'Invalid publication request.' using errcode = '22023';
  end if;
  if (p_owner_user_id is null) = (p_manager_key_hash is null)
    or (p_manager_key_hash is not null and p_manager_key_hash !~ '^[0-9a-f]{64}$') then
    raise exception 'Exactly one valid auction owner is required.' using errcode = '22023';
  end if;
  v_table := 'ba_' || p_environment || '_laptops';
  v_asset_table := 'ba_' || p_environment || '_campaign_assets';
  -- Auth profile name/email can change without changing the publication itself.
  -- The current credential is checked against the current owner on every retry.
  v_parameters := (p_input - 'ownerName' - 'ownerEmail') || jsonb_build_object(
    'auctionClosesAt', (p_input ->> 'auctionClosesAt')::timestamptz
  );
  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ba:' || p_environment || ':create:' || v_key::text, 0)
  );
  execute format('select id, slug, owner_user_id, manager_key_hash, publish_parameters
    from public.%I where idempotency_key = $1 for update', v_table)
    into v_existing using v_key;
  if v_existing.id is not null then
    if not (
      coalesce(p_owner_user_id = v_existing.owner_user_id, false)
      or coalesce(p_manager_key_hash is not null and v_existing.manager_key_hash
        in (p_manager_key_hash, left(p_manager_key_hash, 32)), false)
    ) or v_existing.publish_parameters is distinct from v_parameters then
      return query select false, 'idempotency_conflict'::text, null::uuid, v_slug;
    else
      return query select true, 'already_processed'::text, v_existing.id::uuid, v_existing.slug::text;
    end if;
    return;
  end if;
  -- Serialize this owner's rate-limit check, not just requests for the same slug.
  perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(
    'ba:' || p_environment || ':publish-owner:' || coalesce(p_owner_user_id::text, p_manager_key_hash), 0
  ));
  select * into v_result from public.ba_create_owned_laptop_internal(
    p_environment, v_slug, p_owner_user_id, p_manager_key_hash,
    p_input ->> 'ownerName', p_input ->> 'ownerEmail',
    p_input ->> 'title', p_input ->> 'tagline', p_input ->> 'story', p_input ->> 'objectName',
    (p_input ->> 'goalCents')::bigint, (p_input ->> 'auctionClosesAt')::timestamptz,
    p_input ->> 'photoStoragePath', (p_input ->> 'smallOpeningBidCents')::bigint,
    (p_input ->> 'mediumOpeningBidCents')::bigint, (p_input ->> 'largeOpeningBidCents')::bigint,
    (p_input ->> 'minIncrementCents')::integer, v_key
  );
  if not v_result.accepted then
    return query select false, v_result.reason::text, null::uuid, v_slug;
    return;
  end if;
  perform public.ba_configure_auction_spots_internal(
    p_environment, v_result.laptop_id, p_input -> 'spotLayout',
    (p_input ->> 'smallOpeningBidCents')::bigint, (p_input ->> 'mediumOpeningBidCents')::bigint,
    (p_input ->> 'largeOpeningBidCents')::bigint, (p_input ->> 'minIncrementCents')::integer, v_key
  );
  execute format('insert into public.%I
    (laptop_id, asset_type, asset_name, model_storage_path, model_file_name, idempotency_key)
    values ($1, $2, $3, $4, $5, $6)', v_asset_table)
    using v_result.laptop_id, p_input ->> 'assetType', p_input ->> 'assetName',
      p_input ->> 'modelStoragePath', p_input ->> 'modelFileName', v_key;
  execute format('update public.%I set publish_parameters = $1 where id = $2', v_table)
    using v_parameters, v_result.laptop_id;
  return query select true, 'created'::text, v_result.laptop_id::uuid, v_result.laptop_slug::text;
end;
$$;
revoke all on function public.ba_publish_owned_auction_internal(text, uuid, text, jsonb)
  from public, anon, authenticated, service_role;

create or replace function public.ba_dev_publish_owned_auction(
  p_owner_user_id uuid, p_manager_key_hash text, p_input jsonb
) returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language sql security definer set search_path = ''
as $$
  select * from public.ba_publish_owned_auction_internal('dev', p_owner_user_id, p_manager_key_hash, p_input);
$$;
revoke all on function public.ba_dev_publish_owned_auction(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ba_dev_publish_owned_auction(uuid, text, jsonb) to service_role;

create or replace function public.ba_prod_publish_owned_auction(
  p_owner_user_id uuid, p_manager_key_hash text, p_input jsonb
) returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language sql security definer set search_path = ''
as $$
  select * from public.ba_publish_owned_auction_internal('prod', p_owner_user_id, p_manager_key_hash, p_input);
$$;
revoke all on function public.ba_prod_publish_owned_auction(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.ba_prod_publish_owned_auction(uuid, text, jsonb) to service_role;
