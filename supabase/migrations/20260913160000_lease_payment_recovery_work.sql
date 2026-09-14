-- Durable leases and backoff for bounded, concurrent payment recovery workers.
alter table public.ba_dev_laptop_bid_payments
  add column reconcile_lease_until timestamptz,
  add column reconcile_token uuid,
  add column reconcile_attempts integer not null default 0,
  add column reconcile_last_error text;
alter table public.ba_prod_laptop_bid_payments
  add column reconcile_lease_until timestamptz,
  add column reconcile_token uuid,
  add column reconcile_attempts integer not null default 0,
  add column reconcile_last_error text;

create or replace function public.ba_schedule_new_refund_work()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'refund_pending' and old.status <> 'refund_pending' then
    new.reconcile_after := clock_timestamp();
    new.reconcile_token := null;
    new.reconcile_lease_until := null;
    new.reconcile_attempts := 0;
    new.reconcile_last_error := null;
  end if;
  return new;
end;
$$;

create trigger schedule_refund_work before update on public.ba_dev_laptop_bid_payments
  for each row execute function public.ba_schedule_new_refund_work();
create index ba_dev_refund_work_due_idx on public.ba_dev_laptop_bid_payments(reconcile_after, id)
  where status = 'refund_pending';

create trigger schedule_refund_work before update on public.ba_prod_laptop_bid_payments
  for each row execute function public.ba_schedule_new_refund_work();
create index ba_prod_refund_work_due_idx on public.ba_prod_laptop_bid_payments(reconcile_after, id)
  where status = 'refund_pending';

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
    where status = any($1)
      and (reconcile_lease_until is null or reconcile_lease_until <= clock_timestamp())
      and ($2 is null or laptop_id = $2)
      and ($3 is null or id = $3)
      and (reconcile_after <= clock_timestamp() or $3 is not null)
    order by reconcile_after, id for update skip locked limit 1
  ) update public.%I p set reconcile_token = gen_random_uuid(),
      reconcile_lease_until = clock_timestamp() + interval ''2 minutes'',
      reconcile_attempts = reconcile_attempts + 1
    from candidate c where p.id = c.id returning to_jsonb(p)', v_table, v_table)
    into v_row using case when p_kind = 'payment' then array['pending','paid'] else array['refund_pending'] end,
      p_laptop_id, p_payment_id;
  return v_row;
end;
$$;
revoke all on function public.ba_claim_payment_work_internal(text,text,uuid,uuid) from public, anon, authenticated, service_role;

create or replace function public.ba_dev_claim_payment_work(
  p_kind text, p_laptop_id uuid default null, p_payment_id uuid default null
) returns jsonb language sql security definer set search_path = '' as $$
  select public.ba_claim_payment_work_internal('dev', p_kind, p_laptop_id, p_payment_id);
$$;
revoke all on function public.ba_dev_claim_payment_work(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ba_dev_claim_payment_work(text,uuid,uuid) to service_role;

create or replace function public.ba_prod_claim_payment_work(
  p_kind text, p_laptop_id uuid default null, p_payment_id uuid default null
) returns jsonb language sql security definer set search_path = '' as $$
  select public.ba_claim_payment_work_internal('prod', p_kind, p_laptop_id, p_payment_id);
$$;
revoke all on function public.ba_prod_claim_payment_work(text,uuid,uuid) from public, anon, authenticated;
grant execute on function public.ba_prod_claim_payment_work(text,uuid,uuid) to service_role;
