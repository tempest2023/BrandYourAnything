-- Serialize Connect ownership checks with recovery revocation and auction closure.
-- Preserve parameters before external account creation; never replace a bound account.
alter table public.ba_dev_laptops
  add column stripe_connect_parameters jsonb,
  add column stripe_connect_requested_at timestamptz,
  add column stripe_connect_legacy boolean not null default true;
alter table public.ba_dev_laptops alter column stripe_connect_legacy set default false;
alter table public.ba_prod_laptops
  add column stripe_connect_parameters jsonb,
  add column stripe_connect_requested_at timestamptz,
  add column stripe_connect_legacy boolean not null default true;
alter table public.ba_prod_laptops alter column stripe_connect_legacy set default false;

create or replace function public.ba_owned_stripe_account_internal(
  p_environment text, p_slug text, p_owner_user_id uuid, p_manager_key_hashes text[],
  p_action text, p_account_id text, p_parameters jsonb,
  p_charges_enabled boolean, p_payouts_enabled boolean
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_auction public.ba_dev_laptops%rowtype;
  v_table text;
begin
  if p_environment is null or p_environment not in ('dev','prod')
    or p_action is null or p_action not in ('check','reserve','bind','status') then
    raise exception 'Invalid Connect operation.' using errcode = '22023';
  end if;
  v_table := 'ba_' || p_environment || '_laptops';
  execute format('select * from public.%I where slug = lower($1) for update', v_table)
    into v_auction using p_slug;
  if v_auction.id is null or not (
    coalesce(v_auction.owner_user_id = p_owner_user_id, false)
    or coalesce(v_auction.manager_key_hash = any(p_manager_key_hashes), false)
  ) then return null; end if;

  if p_action = 'reserve' and v_auction.stripe_account_id is null then
    if v_auction.status <> 'published' or clock_timestamp() >= v_auction.auction_closes_at then
      raise exception 'auction_closed';
    end if;
    if v_auction.stripe_connect_parameters is null then
      if p_parameters is null or jsonb_typeof(p_parameters) <> 'object' then
        raise exception 'Connect parameters are required.' using errcode = '22023';
      end if;
      execute format('update public.%I set stripe_connect_parameters = $2,
        stripe_connect_requested_at = clock_timestamp() where id = $1 returning *', v_table)
        into v_auction using v_auction.id, p_parameters;
    end if;
  elsif p_action in ('bind','status') then
    if p_account_id is null or p_account_id !~ '^acct_[A-Za-z0-9]+$' then
      raise exception 'Invalid Stripe account.' using errcode = '22023';
    end if;
    if (v_auction.stripe_account_id is not null and v_auction.stripe_account_id <> p_account_id)
      or (p_action = 'status' and v_auction.stripe_account_id is null) then
      raise exception 'stripe_account_conflict';
    end if;
    execute format('update public.%I set stripe_account_id = $2,
      stripe_charges_enabled = case when $3 then coalesce($4,false) else stripe_charges_enabled end,
      stripe_payouts_enabled = case when $3 then coalesce($5,false) else stripe_payouts_enabled end,
      updated_at = clock_timestamp() where id = $1 returning *', v_table)
      into v_auction using v_auction.id, p_account_id, p_action = 'status', p_charges_enabled, p_payouts_enabled;
  elsif p_action = 'check' and p_account_id is not null and v_auction.stripe_account_id is distinct from p_account_id then
    raise exception 'stripe_account_conflict';
  end if;
  return jsonb_build_object('id',v_auction.id,'slug',v_auction.slug,'title',v_auction.title,
    'accountId',v_auction.stripe_account_id,'parameters',v_auction.stripe_connect_parameters,
    'requestedAt',v_auction.stripe_connect_requested_at,'legacy',v_auction.stripe_connect_legacy);
end;
$$;
revoke all on function public.ba_owned_stripe_account_internal(text,text,uuid,text[],text,text,jsonb,boolean,boolean) from public,anon,authenticated,service_role;

create or replace function public.ba_dev_owned_stripe_account(
  p_slug text, p_owner_user_id uuid, p_manager_key_hashes text[], p_action text,
  p_account_id text default null, p_parameters jsonb default null,
  p_charges_enabled boolean default false, p_payouts_enabled boolean default false
) returns jsonb language sql security definer set search_path = '' as $$
  select public.ba_owned_stripe_account_internal('dev',p_slug,p_owner_user_id,p_manager_key_hashes,
    p_action,p_account_id,p_parameters,p_charges_enabled,p_payouts_enabled);
$$;
revoke all on function public.ba_dev_owned_stripe_account(text,uuid,text[],text,text,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ba_dev_owned_stripe_account(text,uuid,text[],text,text,jsonb,boolean,boolean) to service_role;

create or replace function public.ba_prod_owned_stripe_account(
  p_slug text, p_owner_user_id uuid, p_manager_key_hashes text[], p_action text,
  p_account_id text default null, p_parameters jsonb default null,
  p_charges_enabled boolean default false, p_payouts_enabled boolean default false
) returns jsonb language sql security definer set search_path = '' as $$
  select public.ba_owned_stripe_account_internal('prod',p_slug,p_owner_user_id,p_manager_key_hashes,
    p_action,p_account_id,p_parameters,p_charges_enabled,p_payouts_enabled);
$$;
revoke all on function public.ba_prod_owned_stripe_account(text,uuid,text[],text,text,jsonb,boolean,boolean) from public,anon,authenticated;
grant execute on function public.ba_prod_owned_stripe_account(text,uuid,text[],text,text,jsonb,boolean,boolean) to service_role;
