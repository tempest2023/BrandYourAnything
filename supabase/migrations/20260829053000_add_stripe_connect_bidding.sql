-- Stripe Connect payout accounts and paid bid deposits for tenant auctions.
-- Checkout payments are written here before the public bid ledger is changed.
-- A paid bid is settled by the function below while the target spot is locked;
-- losing or stale payments are marked for a full Stripe refund.

alter table public.ba_dev_laptops
  add column stripe_account_id text,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_payouts_enabled boolean not null default false;

alter table public.ba_prod_laptops
  add column stripe_account_id text,
  add column stripe_charges_enabled boolean not null default false,
  add column stripe_payouts_enabled boolean not null default false;

create unique index ba_dev_laptops_stripe_account_idx
  on public.ba_dev_laptops (stripe_account_id)
  where stripe_account_id is not null;
create unique index ba_prod_laptops_stripe_account_idx
  on public.ba_prod_laptops (stripe_account_id)
  where stripe_account_id is not null;

grant update on table public.ba_dev_laptops to service_role;
grant update on table public.ba_prod_laptops to service_role;

alter table public.ba_dev_laptop_bids
  add column stripe_payment_intent_id text,
  add column deposit_amount_cents bigint
    check (deposit_amount_cents is null or deposit_amount_cents > 0);

alter table public.ba_prod_laptop_bids
  add column stripe_payment_intent_id text,
  add column deposit_amount_cents bigint
    check (deposit_amount_cents is null or deposit_amount_cents > 0);

create unique index ba_dev_laptop_bids_payment_intent_idx
  on public.ba_dev_laptop_bids (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create unique index ba_prod_laptop_bids_payment_intent_idx
  on public.ba_prod_laptop_bids (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;

create table public.ba_dev_laptop_bid_payments (
  id uuid primary key default gen_random_uuid(),
  laptop_id uuid not null references public.ba_dev_laptops(id) on delete cascade,
  spot_position smallint not null check (spot_position between 1 and 10),
  bid_amount_cents bigint not null check (bid_amount_cents between 1000 and 100000000),
  deposit_amount_cents bigint not null check (deposit_amount_cents > 0),
  bidder_name text not null check (char_length(bidder_name) between 1 and 80),
  bidder_email text not null check (char_length(bidder_email) between 3 and 254),
  website text check (website is null or char_length(website) <= 2048),
  x_handle text check (x_handle is null or char_length(x_handle) <= 50),
  logo_storage_path text,
  idempotency_key uuid not null unique,
  stripe_checkout_session_id text unique,
  stripe_payment_intent_id text unique,
  previous_payment_intent_id text,
  accepted_bid_id uuid references public.ba_dev_laptop_bids(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'paid', 'accepted', 'refund_pending', 'refunded', 'expired', 'failed')),
  failure_reason text,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp()
);

create table public.ba_prod_laptop_bid_payments (
  like public.ba_dev_laptop_bid_payments including all,
  constraint ba_prod_laptop_bid_payments_laptop_id_fkey
    foreign key (laptop_id) references public.ba_prod_laptops(id) on delete cascade,
  constraint ba_prod_laptop_bid_payments_accepted_bid_id_fkey
    foreign key (accepted_bid_id) references public.ba_prod_laptop_bids(id) on delete set null
);

-- LIKE copies the development foreign keys on some Postgres versions. Replace
-- them explicitly so production rows can only reference production campaigns.
alter table public.ba_prod_laptop_bid_payments
  drop constraint if exists ba_dev_laptop_bid_payments_laptop_id_fkey,
  drop constraint if exists ba_dev_laptop_bid_payments_accepted_bid_id_fkey;

create index ba_dev_laptop_bid_payments_laptop_idx
  on public.ba_dev_laptop_bid_payments (laptop_id, created_at desc);
create index ba_prod_laptop_bid_payments_laptop_idx
  on public.ba_prod_laptop_bid_payments (laptop_id, created_at desc);

alter table public.ba_dev_laptop_bid_payments enable row level security;
alter table public.ba_prod_laptop_bid_payments enable row level security;
revoke all on table public.ba_dev_laptop_bid_payments from public, anon, authenticated;
revoke all on table public.ba_prod_laptop_bid_payments from public, anon, authenticated;
grant select, insert, update on table public.ba_dev_laptop_bid_payments to service_role;
grant select, insert, update on table public.ba_prod_laptop_bid_payments to service_role;

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
    select * into v_laptop from public.ba_dev_laptops where id = v_payment.laptop_id;
    select * into v_spot
      from public.ba_dev_laptop_spots
      where laptop_id = v_payment.laptop_id and position = v_payment.spot_position
      for update;
  else
    select * into v_laptop from public.ba_prod_laptops where id = v_payment.laptop_id;
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

create or replace function public.ba_dev_settle_laptop_bid_payment(p_payment_id uuid)
returns table (
  accepted boolean, reason text, current_bid_cents bigint,
  minimum_next_bid_cents bigint, current_bidder_name text, bid_count integer,
  previous_payment_intent_id text, bid_id uuid
)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_settle_laptop_bid_payment_internal('dev', p_payment_id);
$$;

create or replace function public.ba_prod_settle_laptop_bid_payment(p_payment_id uuid)
returns table (
  accepted boolean, reason text, current_bid_cents bigint,
  minimum_next_bid_cents bigint, current_bidder_name text, bid_count integer,
  previous_payment_intent_id text, bid_id uuid
)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_settle_laptop_bid_payment_internal('prod', p_payment_id);
$$;

revoke execute on function public.ba_settle_laptop_bid_payment_internal(text, uuid)
  from public, anon, authenticated, service_role;
revoke execute on function public.ba_dev_settle_laptop_bid_payment(uuid)
  from public, anon, authenticated;
revoke execute on function public.ba_prod_settle_laptop_bid_payment(uuid)
  from public, anon, authenticated;
grant execute on function public.ba_dev_settle_laptop_bid_payment(uuid) to service_role;
grant execute on function public.ba_prod_settle_laptop_bid_payment(uuid) to service_role;
