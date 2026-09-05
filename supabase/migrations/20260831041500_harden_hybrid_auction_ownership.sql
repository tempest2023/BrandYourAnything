-- Make browser-to-X ownership claims atomic and retire the legacy creation
-- wrappers that can create campaigns without an owner credential.

create or replace function public.ba_claim_auction_internal(
  p_environment text,
  p_slug text,
  p_manager_key_hashes text[],
  p_owner_user_id uuid,
  p_owner_name text,
  p_owner_email text
)
returns table (
  accepted boolean,
  reason text,
  laptop_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_laptop_id uuid;
  v_current_owner_user_id uuid;
begin
  if p_environment not in ('dev', 'prod')
    or p_owner_user_id is null
    or coalesce(array_length(p_manager_key_hashes, 1), 0) = 0
    or p_owner_name is null
    or p_owner_email is null then
    raise exception 'Auction claim input is invalid.' using errcode = '22023';
  end if;

  if p_environment = 'dev' then
    select id, owner_user_id
      into v_laptop_id, v_current_owner_user_id
    from public.ba_dev_laptops
    where slug = lower(p_slug)
      and manager_key_hash = any(p_manager_key_hashes)
    for update;
  else
    select id, owner_user_id
      into v_laptop_id, v_current_owner_user_id
    from public.ba_prod_laptops
    where slug = lower(p_slug)
      and manager_key_hash = any(p_manager_key_hashes)
    for update;
  end if;

  if v_laptop_id is null then
    return query select false, 'not_found'::text, null::uuid;
    return;
  end if;

  if v_current_owner_user_id is not null
    and v_current_owner_user_id <> p_owner_user_id then
    return query select false, 'claimed_by_another_user'::text, v_laptop_id;
    return;
  end if;

  if v_current_owner_user_id = p_owner_user_id then
    return query select true, 'already_claimed'::text, v_laptop_id;
    return;
  end if;

  if p_environment = 'dev' then
    update public.ba_dev_laptops
    set owner_user_id = p_owner_user_id,
        owner_name = left(trim(p_owner_name), 80),
        owner_email = lower(trim(p_owner_email)),
        updated_at = clock_timestamp()
    where id = v_laptop_id;
  else
    update public.ba_prod_laptops
    set owner_user_id = p_owner_user_id,
        owner_name = left(trim(p_owner_name), 80),
        owner_email = lower(trim(p_owner_email)),
        updated_at = clock_timestamp()
    where id = v_laptop_id;
  end if;

  return query select true, 'claimed'::text, v_laptop_id;
end;
$$;

create or replace function public.ba_dev_claim_auction(
  p_slug text,
  p_manager_key_hashes text[],
  p_owner_user_id uuid,
  p_owner_name text,
  p_owner_email text
)
returns table (accepted boolean, reason text, laptop_id uuid)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_claim_auction_internal(
    'dev', p_slug, p_manager_key_hashes, p_owner_user_id,
    p_owner_name, p_owner_email
  );
$$;

create or replace function public.ba_prod_claim_auction(
  p_slug text,
  p_manager_key_hashes text[],
  p_owner_user_id uuid,
  p_owner_name text,
  p_owner_email text
)
returns table (accepted boolean, reason text, laptop_id uuid)
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_claim_auction_internal(
    'prod', p_slug, p_manager_key_hashes, p_owner_user_id,
    p_owner_name, p_owner_email
  );
$$;

revoke all on function public.ba_claim_auction_internal(
  text, text, text[], uuid, text, text
) from public, anon, authenticated, service_role;
revoke all on function public.ba_dev_claim_auction(
  text, text[], uuid, text, text
) from public, anon, authenticated;
revoke all on function public.ba_prod_claim_auction(
  text, text[], uuid, text, text
) from public, anon, authenticated;

grant execute on function public.ba_dev_claim_auction(
  text, text[], uuid, text, text
) to service_role;
grant execute on function public.ba_prod_claim_auction(
  text, text[], uuid, text, text
) to service_role;

revoke execute on function public.ba_dev_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) from service_role;
revoke execute on function public.ba_prod_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) from service_role;
