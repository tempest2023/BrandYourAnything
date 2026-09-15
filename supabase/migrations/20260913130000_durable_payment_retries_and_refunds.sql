-- Keep the charge's account and exact Checkout request durable across retries.

alter table public.ba_dev_laptop_bid_payments
  add column stripe_account_id text,
  add column checkout_parameters jsonb,
  add column stripe_refund_id text,
  add column refund_status text;
update public.ba_dev_laptop_bid_payments p set stripe_account_id = a.stripe_account_id
  from public.ba_dev_laptops a where a.id = p.laptop_id;
-- Existing refunds must be checked with Stripe, not assumed complete from a
-- successful HTTP create response. Old losing leaders also become durable work.
update public.ba_dev_laptop_bid_payments p
  set status = 'refund_pending', failure_reason = coalesce(p.failure_reason, 'outbid'), updated_at = clock_timestamp()
  where p.status = 'refunded' or (
    p.status = 'accepted' and exists (
      select 1 from public.ba_dev_laptop_bids b
      where b.laptop_id = p.laptop_id and b.spot_id = (
        select id from public.ba_dev_laptop_spots s where s.laptop_id = p.laptop_id and s.position = p.spot_position
      ) and b.amount_cents > p.bid_amount_cents
    )
  );
create index ba_dev_pending_refunds_idx on public.ba_dev_laptop_bid_payments(updated_at)
  where status = 'refund_pending';

alter table public.ba_prod_laptop_bid_payments
  add column stripe_account_id text,
  add column checkout_parameters jsonb,
  add column stripe_refund_id text,
  add column refund_status text;
update public.ba_prod_laptop_bid_payments p set stripe_account_id = a.stripe_account_id
  from public.ba_prod_laptops a where a.id = p.laptop_id;
-- Existing refunds must be checked with Stripe, not assumed complete from a
-- successful HTTP create response. Old losing leaders also become durable work.
update public.ba_prod_laptop_bid_payments p
  set status = 'refund_pending', failure_reason = coalesce(p.failure_reason, 'outbid'), updated_at = clock_timestamp()
  where p.status = 'refunded' or (
    p.status = 'accepted' and exists (
      select 1 from public.ba_prod_laptop_bids b
      where b.laptop_id = p.laptop_id and b.spot_id = (
        select id from public.ba_prod_laptop_spots s where s.laptop_id = p.laptop_id and s.position = p.spot_position
      ) and b.amount_cents > p.bid_amount_cents
    )
  );
create index ba_prod_pending_refunds_idx on public.ba_prod_laptop_bid_payments(updated_at)
  where status = 'refund_pending';

create or replace function public.ba_guard_bid_payment_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.laptop_id,new.spot_position,new.bid_amount_cents,new.deposit_amount_cents,
    new.bidder_name,new.bidder_email,new.website,new.x_handle,new.logo_storage_path,new.idempotency_key,new.created_at)
    is distinct from
    row(old.laptop_id,old.spot_position,old.bid_amount_cents,old.deposit_amount_cents,
    old.bidder_name,old.bidder_email,old.website,old.x_handle,old.logo_storage_path,old.idempotency_key,old.created_at)
    or (old.stripe_account_id is not null and new.stripe_account_id is distinct from old.stripe_account_id)
    or (old.checkout_parameters is not null and new.checkout_parameters is distinct from old.checkout_parameters)
    or (old.stripe_checkout_session_id is not null and new.stripe_checkout_session_id is distinct from old.stripe_checkout_session_id)
    or (old.stripe_payment_intent_id is not null and new.stripe_payment_intent_id is distinct from old.stripe_payment_intent_id)
    or (old.stripe_refund_id is not null and new.stripe_refund_id is distinct from old.stripe_refund_id) then
    raise exception 'Payment identity is immutable.' using errcode = '22023';
  end if;
  if new.status <> old.status and not (
    (old.status = 'pending' and new.status in ('paid','expired','failed'))
    or (old.status = 'paid' and new.status in ('accepted','refund_pending'))
    or (old.status = 'accepted' and new.status = 'refund_pending')
    or (old.status = 'refund_pending' and new.status = 'refunded')
  ) then raise exception 'Invalid payment state transition.' using errcode = '22023'; end if;
  return new;
end;
$$;
revoke all on function public.ba_guard_bid_payment_update() from public, anon, authenticated, service_role;
create trigger ba_dev_guard_bid_payment_update before update on public.ba_dev_laptop_bid_payments for each row execute function public.ba_guard_bid_payment_update();
create trigger ba_prod_guard_bid_payment_update before update on public.ba_prod_laptop_bid_payments for each row execute function public.ba_guard_bid_payment_update();

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
    where id = p_payment_id;
  else
    select * into v_payment
    from public.ba_prod_laptop_bid_payments
    where id = p_payment_id;
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

  -- Every settlement takes auction -> spot -> payment locks in this order.
  -- This also permits queuing the previous leader without a payment/auction cycle.
  if p_environment = 'dev' then
    select * into v_payment from public.ba_dev_laptop_bid_payments where id = p_payment_id for update;
  else
    select * into v_payment from public.ba_prod_laptop_bid_payments where id = p_payment_id for update;
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
      order by amount_cents desc, id desc
      limit 1;

    -- The refund obligation commits atomically with replacing the winner.
    update public.ba_dev_laptop_bid_payments set status = 'refund_pending',
      failure_reason = 'outbid', updated_at = clock_timestamp()
      where stripe_payment_intent_id = v_previous_payment_intent_id and status = 'accepted';

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
      order by amount_cents desc, id desc
      limit 1;

    -- The refund obligation commits atomically with replacing the winner.
    update public.ba_prod_laptop_bid_payments set status = 'refund_pending',
      failure_reason = 'outbid', updated_at = clock_timestamp()
      where stripe_payment_intent_id = v_previous_payment_intent_id and status = 'accepted';

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
