-- Preserve the pre-upgrade protocol for ambiguous old Checkout attempts.

alter table public.ba_dev_laptop_bid_payments
  add column checkout_request_version smallint not null default 1,
  add column reconcile_after timestamptz not null default clock_timestamp();
alter table public.ba_dev_laptop_bid_payments alter column checkout_request_version set default 2;
create index ba_dev_payment_reconciliation_idx on public.ba_dev_laptop_bid_payments(reconcile_after)
  where status in ('pending','paid');

alter table public.ba_prod_laptop_bid_payments
  add column checkout_request_version smallint not null default 1,
  add column reconcile_after timestamptz not null default clock_timestamp();
alter table public.ba_prod_laptop_bid_payments alter column checkout_request_version set default 2;
create index ba_prod_payment_reconciliation_idx on public.ba_prod_laptop_bid_payments(reconcile_after)
  where status in ('pending','paid');

-- Late verified payments may be compensated, but never become winning bids.
create or replace function public.ba_guard_bid_payment_update()
returns trigger language plpgsql set search_path = '' as $$
begin
  if row(new.laptop_id,new.spot_position,new.bid_amount_cents,new.deposit_amount_cents,
    new.bidder_name,new.bidder_email,new.website,new.x_handle,new.logo_storage_path,new.idempotency_key,new.created_at,new.checkout_request_version)
    is distinct from
    row(old.laptop_id,old.spot_position,old.bid_amount_cents,old.deposit_amount_cents,
    old.bidder_name,old.bidder_email,old.website,old.x_handle,old.logo_storage_path,old.idempotency_key,old.created_at,old.checkout_request_version)
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
    or (old.status in ('expired','failed') and new.status = 'refund_pending')
  ) then raise exception 'Invalid payment state transition.' using errcode = '22023'; end if;
  return new;
end;
$$;
