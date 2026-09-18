-- Service-only backlog visibility. Operators alert on recovery work that is
-- due, stuck behind a lease or repeatedly failing, without any browser access.

create or replace function public.ba_payment_recovery_backlog_internal(p_environment text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_table text;
  v_result jsonb;
begin
  if p_environment is null or p_environment not in ('dev', 'prod') then
    raise exception 'Invalid recovery environment.' using errcode = '22023';
  end if;
  v_table := 'ba_' || p_environment || '_laptop_bid_payments';
  execute format($sql$
    select jsonb_build_object(
      'paymentDue', count(*) filter (
        where status in ('pending', 'paid')
          and (reconcile_lease_until is null or reconcile_lease_until <= clock_timestamp())
          and reconcile_after <= clock_timestamp()),
      'refundDue', count(*) filter (
        where status = 'refund_pending'
          and (reconcile_lease_until is null or reconcile_lease_until <= clock_timestamp())
          and reconcile_after <= clock_timestamp()),
      'refundOutstanding', count(*) filter (where status = 'refund_pending'),
      'leased', count(*) filter (where reconcile_lease_until > clock_timestamp()),
      'blocked', count(*) filter (
        where status in ('pending', 'paid', 'refund_pending')
          and reconcile_last_error is not null
          and reconcile_attempts >= 3),
      'oldestDueAt', min(updated_at) filter (
        where status in ('pending', 'paid', 'refund_pending')
          and (reconcile_lease_until is null or reconcile_lease_until <= clock_timestamp()))
    ) from public.%I
  $sql$, v_table) into v_result;
  return v_result;
end;
$$;
revoke all on function public.ba_payment_recovery_backlog_internal(text)
  from public, anon, authenticated, service_role;

create or replace function public.ba_dev_payment_recovery_backlog()
returns jsonb language sql security definer set search_path = '' as $$
  select public.ba_payment_recovery_backlog_internal('dev');
$$;
revoke all on function public.ba_dev_payment_recovery_backlog() from public, anon, authenticated;
grant execute on function public.ba_dev_payment_recovery_backlog() to service_role;

create or replace function public.ba_prod_payment_recovery_backlog()
returns jsonb language sql security definer set search_path = '' as $$
  select public.ba_payment_recovery_backlog_internal('prod');
$$;
revoke all on function public.ba_prod_payment_recovery_backlog() from public, anon, authenticated;
grant execute on function public.ba_prod_payment_recovery_backlog() to service_role;
