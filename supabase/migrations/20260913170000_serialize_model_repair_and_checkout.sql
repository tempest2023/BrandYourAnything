-- A buyer's displayed asset revision is checked while reserving the payment.
-- Model repair and reservation both lock the auction before reading its asset.
alter table public.ba_dev_laptop_bid_payments add column asset_version uuid;
alter table public.ba_prod_laptop_bid_payments add column asset_version uuid;

create or replace function public.ba_guard_payment_asset()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_prefix text := case tg_table_name when 'ba_dev_laptop_bid_payments' then 'ba_dev' when 'ba_prod_laptop_bid_payments' then 'ba_prod' end;
  v_version uuid;
  v_status text;
  v_closes timestamptz;
begin
  if v_prefix is null then raise exception 'Invalid payment table.'; end if;
  if tg_op = 'UPDATE' then
    if new.asset_version is distinct from old.asset_version then
      raise exception 'Payment asset identity is immutable.' using errcode = '22023';
    end if;
    return new;
  end if;
  execute format('select status, auction_closes_at from public.%I where id = $1 for update', v_prefix || '_laptops')
    into v_status, v_closes using new.laptop_id;
  if v_status is null or v_status <> 'published' or v_closes <= clock_timestamp() then
    raise exception 'auction_closed' using errcode = 'P0001';
  end if;
  execute format('select idempotency_key from public.%I where laptop_id = $1', v_prefix || '_campaign_assets')
    into v_version using new.laptop_id;
  if new.asset_version is distinct from v_version then
    raise exception 'auction_asset_changed' using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.ba_guard_payment_asset() from public, anon, authenticated, service_role;
create trigger guard_payment_asset before insert or update of asset_version on public.ba_dev_laptop_bid_payments
  for each row execute function public.ba_guard_payment_asset();
create trigger guard_payment_asset before insert or update of asset_version on public.ba_prod_laptop_bid_payments
  for each row execute function public.ba_guard_payment_asset();

create or replace function public.ba_manage_owned_auction_internal(
  p_environment text, p_slug text, p_owner_user_id uuid,
  p_manager_key_hashes text[], p_action text, p_model jsonb
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_auction public.ba_dev_laptops%rowtype;
  v_asset public.ba_dev_campaign_assets%rowtype;
  v_has_bids boolean;
  v_has_payments boolean;
begin
  if p_environment is null or p_environment not in ('dev', 'prod')
    or p_action is null or p_action not in ('close', 'model') then
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
    if p_model is null or not (p_model ? 'expectedAssetVersion')
      or nullif(p_model->>'assetName', '') is null
      or nullif(p_model->>'modelStoragePath', '') is null
      or nullif(p_model->>'modelFileName', '') is null
      or nullif(p_model->>'idempotencyKey', '') is null then
      raise exception 'Invalid model repair.' using errcode = '22023';
    end if;
    execute format('select * from public.%I where laptop_id = $1', 'ba_' || p_environment || '_campaign_assets')
      into v_asset using v_auction.id;
    -- A lost-response retry acknowledges its committed result without rewriting
    -- the advertised object, even when bids or closure happened afterwards.
    if v_asset.asset_type = 'anything' and v_asset.asset_name = p_model->>'assetName'
      and v_asset.model_storage_path = p_model->>'modelStoragePath'
      and v_asset.model_file_name = p_model->>'modelFileName'
      and v_asset.idempotency_key = (p_model->>'idempotencyKey')::uuid then
      return to_jsonb(v_auction);
    end if;
    if v_asset.idempotency_key is distinct from (p_model->>'expectedAssetVersion')::uuid then
      raise exception 'auction_asset_changed';
    end if;
    if v_auction.status <> 'published' or clock_timestamp() >= v_auction.auction_closes_at then
      raise exception 'auction_closed';
    end if;
    execute format('select exists(select 1 from public.%I where laptop_id = $1)', 'ba_' || p_environment || '_laptop_bids')
      into v_has_bids using v_auction.id;
    if v_has_bids then raise exception 'auction_model_locked_by_bids'; end if;
    execute format('select exists(select 1 from public.%I where laptop_id = $1 and status in (''pending'', ''paid''))',
      'ba_' || p_environment || '_laptop_bid_payments') into v_has_payments using v_auction.id;
    if v_has_payments then raise exception 'auction_model_locked_by_payments'; end if;
    execute format(
      'insert into public.%I (laptop_id, asset_type, asset_name, model_storage_path, model_file_name, idempotency_key)
       values ($1, ''anything'', $2, $3, $4, $5)
       on conflict (laptop_id) do update set asset_type = excluded.asset_type, asset_name = excluded.asset_name,
         model_storage_path = excluded.model_storage_path, model_file_name = excluded.model_file_name,
         idempotency_key = excluded.idempotency_key', 'ba_' || p_environment || '_campaign_assets')
      using v_auction.id, p_model->>'assetName', p_model->>'modelStoragePath',
        p_model->>'modelFileName', (p_model->>'idempotencyKey')::uuid;
  end if;
  return to_jsonb(v_auction);
end;
$$;
revoke all on function public.ba_manage_owned_auction_internal(text,text,uuid,text[],text,jsonb) from public, anon, authenticated, service_role;
