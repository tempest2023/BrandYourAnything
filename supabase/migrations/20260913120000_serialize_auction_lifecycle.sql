-- Ownership, closure and object repair share the auction-row lock with settlement.
-- Credentials are checked after acquiring that lock, including during a revoke race.
create or replace function public.ba_manage_owned_auction_internal(
  p_environment text, p_slug text, p_owner_user_id uuid,
  p_manager_key_hashes text[], p_action text, p_model jsonb
) returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_auction public.ba_dev_laptops%rowtype;
  v_has_bids boolean;
begin
  if p_environment not in ('dev', 'prod') or p_action not in ('close', 'model') then
    raise exception 'Invalid management action.' using errcode = '22023';
  end if;
  execute format('select * from public.%I where slug = lower($1) for update', 'ba_' || p_environment || '_laptops')
    into v_auction using p_slug;
  if v_auction.id is null or not (
    coalesce(v_auction.owner_user_id = p_owner_user_id, false)
    or coalesce(v_auction.manager_key_hash = any(p_manager_key_hashes), false)
  ) then return null; end if;

  if p_action = 'close' then
    execute format('update public.%I set status = ''closed'', updated_at = clock_timestamp() where id = $1 returning *',
      'ba_' || p_environment || '_laptops') into v_auction using v_auction.id;
  else
    if v_auction.status <> 'published' or clock_timestamp() >= v_auction.auction_closes_at then
      raise exception 'auction_closed';
    end if;
    execute format('select exists(select 1 from public.%I where laptop_id = $1)', 'ba_' || p_environment || '_laptop_bids')
      into v_has_bids using v_auction.id;
    if v_has_bids then raise exception 'auction_model_locked_by_bids'; end if;
    execute format(
      'insert into public.%I (laptop_id, asset_type, asset_name, model_storage_path, model_file_name, idempotency_key)
       values ($1, ''anything'', $2, $3, $4, $5)
       on conflict (laptop_id) do update set
         asset_type = excluded.asset_type, asset_name = excluded.asset_name,
         model_storage_path = excluded.model_storage_path, model_file_name = excluded.model_file_name,
         idempotency_key = excluded.idempotency_key',
      'ba_' || p_environment || '_campaign_assets')
      using v_auction.id, p_model->>'assetName', p_model->>'modelStoragePath',
        p_model->>'modelFileName', (p_model->>'idempotencyKey')::uuid;
  end if;
  return to_jsonb(v_auction);
end;
$$;
revoke all on function public.ba_manage_owned_auction_internal(text, text, uuid, text[], text, jsonb) from public, anon, authenticated, service_role;

create or replace function public.ba_dev_manage_owned_auction(
  p_slug text, p_owner_user_id uuid, p_manager_key_hashes text[],
  p_action text, p_model jsonb default null
) returns jsonb language sql security definer set search_path = ''
as $$
  select public.ba_manage_owned_auction_internal('dev', p_slug, p_owner_user_id, p_manager_key_hashes, p_action, p_model);
$$;
revoke all on function public.ba_dev_manage_owned_auction(text, uuid, text[], text, jsonb) from public, anon, authenticated;
grant execute on function public.ba_dev_manage_owned_auction(text, uuid, text[], text, jsonb) to service_role;

create or replace function public.ba_prod_manage_owned_auction(
  p_slug text, p_owner_user_id uuid, p_manager_key_hashes text[],
  p_action text, p_model jsonb default null
) returns jsonb language sql security definer set search_path = ''
as $$
  select public.ba_manage_owned_auction_internal('prod', p_slug, p_owner_user_id, p_manager_key_hashes, p_action, p_model);
$$;
revoke all on function public.ba_prod_manage_owned_auction(text, uuid, text[], text, jsonb) from public, anon, authenticated;
grant execute on function public.ba_prod_manage_owned_auction(text, uuid, text[], text, jsonb) to service_role;

-- Linearize closure/model repair and paid bids at the same auction row.
create or replace function public.ba_settle_laptop_bid_payment_internal(
  p_environment text,
  p_payment_id uuid
)
returns table (
  accepted boolean,
  reason text,
  current_bid_cents bigint,
  minimum_next_bid_cents bigint,
  current_bidder_name text,
  bid_count integer,
  previous_payment_intent_id text,
  bid_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_payment public.ba_dev_laptop_bid_payments%rowtype;
  v_laptop public.ba_dev_laptops%rowtype;
  v_spot public.ba_dev_laptop_spots%rowtype;
  v_bid_id uuid;
  v_minimum_bid_cents bigint;
  v_previous_payment_intent_id text;
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'Payment environment is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ba:' || p_environment || ':stripe-bid:' || p_payment_id::text, 0)
  );

  if p_environment = 'dev' then
    select * into v_payment
    from public.ba_dev_laptop_bid_payments
    where id = p_payment_id
    for update;
  else
    select * into v_payment
    from public.ba_prod_laptop_bid_payments
    where id = p_payment_id
    for update;
  end if;

  if not found then
    return query select false, 'payment_not_found'::text, 0::bigint, 0::bigint, ''::text, 0, null::text, null::uuid;
    return;
  end if;

  if p_environment = 'dev' then
    select * into v_laptop from public.ba_dev_laptops where id = v_payment.laptop_id for update;
    select * into v_spot
      from public.ba_dev_laptop_spots
      where laptop_id = v_payment.laptop_id and position = v_payment.spot_position
      for update;
  else
    select * into v_laptop from public.ba_prod_laptops where id = v_payment.laptop_id for update;
    select * into v_spot
      from public.ba_prod_laptop_spots
      where laptop_id = v_payment.laptop_id and position = v_payment.spot_position
      for update;
  end if;

  if v_laptop.id is null or v_spot.id is null then
    raise exception 'Paid bid target does not exist.' using errcode = '22023';
  end if;

  v_minimum_bid_cents := case
    when v_spot.current_bid_cents is null then v_spot.opening_bid_cents
    else v_spot.current_bid_cents + v_spot.min_increment_cents
  end;

  if v_payment.status = 'accepted' then
    return query select
      true,
      'already_processed'::text,
      coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents,
      coalesce(v_spot.current_bidder_name, ''),
      v_spot.bid_count,
      v_payment.previous_payment_intent_id,
      v_payment.accepted_bid_id;
    return;
  end if;

  if v_payment.status in ('refund_pending', 'refunded', 'expired', 'failed') then
    return query select
      false,
      coalesce(v_payment.failure_reason, v_payment.status),
      coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents,
      coalesce(v_spot.current_bidder_name, ''),
      v_spot.bid_count,
      null::text,
      null::uuid;
    return;
  end if;

  if v_payment.status <> 'paid' or v_payment.stripe_payment_intent_id is null then
    return query select
      false, 'payment_not_paid'::text, coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents, coalesce(v_spot.current_bidder_name, ''),
      v_spot.bid_count, null::text, null::uuid;
    return;
  end if;

  if v_laptop.status <> 'published' or clock_timestamp() >= v_laptop.auction_closes_at then
    if p_environment = 'dev' then
      update public.ba_dev_laptop_bid_payments
        set status = 'refund_pending', failure_reason = 'auction_closed', updated_at = clock_timestamp()
        where id = p_payment_id;
    else
      update public.ba_prod_laptop_bid_payments
        set status = 'refund_pending', failure_reason = 'auction_closed', updated_at = clock_timestamp()
        where id = p_payment_id;
    end if;
    return query select false, 'auction_closed'::text, coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents, coalesce(v_spot.current_bidder_name, ''), v_spot.bid_count,
      null::text, null::uuid;
    return;
  end if;

  if v_payment.bid_amount_cents < v_minimum_bid_cents then
    if p_environment = 'dev' then
      update public.ba_dev_laptop_bid_payments
        set status = 'refund_pending', failure_reason = 'bid_too_low', updated_at = clock_timestamp()
        where id = p_payment_id;
    else
      update public.ba_prod_laptop_bid_payments
        set status = 'refund_pending', failure_reason = 'bid_too_low', updated_at = clock_timestamp()
        where id = p_payment_id;
    end if;
    return query select false, 'bid_too_low'::text, coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents, coalesce(v_spot.current_bidder_name, ''), v_spot.bid_count,
      null::text, null::uuid;
    return;
  end if;

  if p_environment = 'dev' then
    select stripe_payment_intent_id into v_previous_payment_intent_id
      from public.ba_dev_laptop_bids
      where laptop_id = v_payment.laptop_id and spot_id = v_spot.id
      order by created_at desc
      limit 1;

    insert into public.ba_dev_laptop_bids (
      laptop_id, spot_id, amount_cents, bidder_name, bidder_email,
      website, x_handle, logo_storage_path, idempotency_key,
      stripe_payment_intent_id, deposit_amount_cents
    ) values (
      v_payment.laptop_id, v_spot.id, v_payment.bid_amount_cents,
      v_payment.bidder_name, v_payment.bidder_email, v_payment.website,
      v_payment.x_handle, v_payment.logo_storage_path, v_payment.idempotency_key,
      v_payment.stripe_payment_intent_id, v_payment.deposit_amount_cents
    ) returning id into v_bid_id;

    update public.ba_dev_laptop_spots as target_spot set
      current_bid_cents = v_payment.bid_amount_cents,
      current_bidder_name = v_payment.bidder_name,
      current_logo_storage_path = v_payment.logo_storage_path,
      current_website = v_payment.website,
      bid_count = target_spot.bid_count + 1,
      updated_at = clock_timestamp()
    where id = v_spot.id;

    update public.ba_dev_laptop_bid_payments set
      status = 'accepted', accepted_bid_id = v_bid_id,
      previous_payment_intent_id = v_previous_payment_intent_id,
      updated_at = clock_timestamp()
    where id = p_payment_id;
  else
    select stripe_payment_intent_id into v_previous_payment_intent_id
      from public.ba_prod_laptop_bids
      where laptop_id = v_payment.laptop_id and spot_id = v_spot.id
      order by created_at desc
      limit 1;

    insert into public.ba_prod_laptop_bids (
      laptop_id, spot_id, amount_cents, bidder_name, bidder_email,
      website, x_handle, logo_storage_path, idempotency_key,
      stripe_payment_intent_id, deposit_amount_cents
    ) values (
      v_payment.laptop_id, v_spot.id, v_payment.bid_amount_cents,
      v_payment.bidder_name, v_payment.bidder_email, v_payment.website,
      v_payment.x_handle, v_payment.logo_storage_path, v_payment.idempotency_key,
      v_payment.stripe_payment_intent_id, v_payment.deposit_amount_cents
    ) returning id into v_bid_id;

    update public.ba_prod_laptop_spots as target_spot set
      current_bid_cents = v_payment.bid_amount_cents,
      current_bidder_name = v_payment.bidder_name,
      current_logo_storage_path = v_payment.logo_storage_path,
      current_website = v_payment.website,
      bid_count = target_spot.bid_count + 1,
      updated_at = clock_timestamp()
    where id = v_spot.id;

    update public.ba_prod_laptop_bid_payments set
      status = 'accepted', accepted_bid_id = v_bid_id,
      previous_payment_intent_id = v_previous_payment_intent_id,
      updated_at = clock_timestamp()
    where id = p_payment_id;
  end if;

  return query select true, 'accepted'::text, v_payment.bid_amount_cents,
    v_payment.bid_amount_cents + v_spot.min_increment_cents, v_payment.bidder_name,
    v_spot.bid_count + 1, v_previous_payment_intent_id, v_bid_id;
end;
$$;
