-- Customer refunds and platform-fee refunds are independent obligations.
alter table public.ba_dev_laptop_bid_payments
  add column application_fee_id text,
  add column application_fee_refunded boolean not null default false,
  add column application_fee_refunded_at timestamptz;
alter table public.ba_prod_laptop_bid_payments
  add column application_fee_id text,
  add column application_fee_refunded boolean not null default false,
  add column application_fee_refunded_at timestamptz;

-- Recheck historical customer refunds instead of assuming their fees were returned.
update public.ba_dev_laptop_bid_payments set reconcile_after = clock_timestamp()
  where status = 'refunded';
update public.ba_prod_laptop_bid_payments set reconcile_after = clock_timestamp()
  where status = 'refunded';

create index ba_dev_fee_refund_due_idx on public.ba_dev_laptop_bid_payments(reconcile_after, id)
  where status = 'refunded' and not application_fee_refunded;
create index ba_prod_fee_refund_due_idx on public.ba_prod_laptop_bid_payments(reconcile_after, id)
  where status = 'refunded' and not application_fee_refunded;

create or replace function public.ba_guard_application_fee_refund()
returns trigger language plpgsql set search_path = '' as $$
begin
  if old.application_fee_id is not null and new.application_fee_id is distinct from old.application_fee_id then
    raise exception 'Application fee identity is immutable.' using errcode = '22023';
  end if;
  if old.application_fee_refunded and not new.application_fee_refunded then
    raise exception 'Completed application fee refund cannot regress.' using errcode = '22023';
  end if;
  if new.application_fee_refunded and (
    new.application_fee_id is null or new.application_fee_refunded_at is null
    or new.status <> 'refunded' or new.refund_status is distinct from 'succeeded'
  ) then raise exception 'Customer and application fee refunds must be verified separately.' using errcode = '22023'; end if;
  return new;
end;
$$;
revoke all on function public.ba_guard_application_fee_refund() from public, anon, authenticated, service_role;
create trigger guard_application_fee_refund before update on public.ba_dev_laptop_bid_payments
  for each row execute function public.ba_guard_application_fee_refund();
create trigger guard_application_fee_refund before update on public.ba_prod_laptop_bid_payments
  for each row execute function public.ba_guard_application_fee_refund();

create or replace function public.ba_claim_payment_work_internal(
  p_environment text, p_kind text, p_laptop_id uuid, p_payment_id uuid
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_table text;
  v_row jsonb;
begin
  if p_environment is null or p_environment not in ('dev', 'prod')
    or p_kind is null or p_kind not in ('payment', 'refund') then
    raise exception 'Invalid recovery queue.' using errcode = '22023';
  end if;
  v_table := 'ba_' || p_environment || '_laptop_bid_payments';
  execute format('with candidate as (
    select id from public.%I
    where (($1 = ''payment'' and status in (''pending'', ''paid''))
      or ($1 = ''refund'' and (status = ''refund_pending'' or (status = ''refunded'' and not application_fee_refunded))))
      and (reconcile_lease_until is null or reconcile_lease_until <= clock_timestamp())
      and ($2 is null or laptop_id = $2)
      and ($3 is null or id = $3)
      and (reconcile_after <= clock_timestamp() or $3 is not null)
    order by reconcile_after, id for update skip locked limit 1
  ) update public.%I p set reconcile_token = gen_random_uuid(),
      reconcile_lease_until = clock_timestamp() + interval ''2 minutes'',
      reconcile_attempts = reconcile_attempts + 1
    from candidate c where p.id = c.id returning to_jsonb(p)', v_table, v_table)
    into v_row using p_kind,
      p_laptop_id, p_payment_id;
  return v_row;
end;
$$;
revoke all on function public.ba_claim_payment_work_internal(text,text,uuid,uuid) from public, anon, authenticated, service_role;
