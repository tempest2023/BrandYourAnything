-- Allow object campaigns to publish and receive bids on 1–20 placements.
-- Application validation continues to keep legacy laptop layouts at 6 or 10.

alter table public.ba_dev_laptop_spots
  drop constraint if exists ba_dev_laptop_spots_position_check,
  drop constraint if exists ba_prod_laptop_spots_position_check,
  add constraint ba_dev_laptop_spots_position_check check (position between 1 and 20);

alter table public.ba_prod_laptop_spots
  drop constraint if exists ba_dev_laptop_spots_position_check,
  drop constraint if exists ba_prod_laptop_spots_position_check,
  add constraint ba_prod_laptop_spots_position_check check (position between 1 and 20);

create or replace function public.ba_configure_laptop_spots_internal(
  p_environment text,
  p_laptop_id uuid,
  p_layout jsonb,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_stored_layout jsonb;
  v_stored_key uuid;
  v_count integer;
  v_valid boolean;
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'Laptop environment is invalid.' using errcode = '22023';
  end if;
  if jsonb_typeof(p_layout) <> 'array' then
    raise exception 'Spot layout must be an array.' using errcode = '22023';
  end if;
  v_count := jsonb_array_length(p_layout);
  if v_count not between 1 and 20 then
    raise exception 'Spot layout count is invalid.' using errcode = '22023';
  end if;
  if p_small_opening_bid_cents not between 100 and 100000000000
    or p_medium_opening_bid_cents not between 100 and 100000000000
    or p_large_opening_bid_cents not between 100 and 100000000000
    or p_min_increment_cents not between 100 and 1000000 then
    raise exception 'Spot pricing is invalid.' using errcode = '22023';
  end if;

  select bool_and(coalesce(
    (entry.value ->> 'id')::integer = entry.ordinality
    and entry.value ->> 'size' in ('S', 'M', 'L')
    and char_length(trim(entry.value ->> 'name')) between 2 and 80
    and char_length(trim(entry.value ->> 'dimensions')) between 2 and 100
    and case
      when jsonb_typeof(entry.value -> 'openingBidCents') = 'number'
        then (entry.value ->> 'openingBidCents')::bigint between 100 and 100000000000
      else false
    end
    and (
      entry.value -> 'position' is null
      or (jsonb_typeof(entry.value -> 'position') = 'array' and jsonb_array_length(entry.value -> 'position') = 3)
    )
    and (
      entry.value -> 'normal' is null
      or (jsonb_typeof(entry.value -> 'normal') = 'array' and jsonb_array_length(entry.value -> 'normal') = 3)
    )
  , false)) into v_valid
  from jsonb_array_elements(p_layout) with ordinality as entry(value, ordinality);
  if not coalesce(v_valid, false) then
    raise exception 'Spot layout entries are invalid.' using errcode = '22023';
  end if;

  if p_environment = 'dev' then
    select spot_layout, idempotency_key into v_stored_layout, v_stored_key
    from public.ba_dev_laptops where id = p_laptop_id for update;
  else
    select spot_layout, idempotency_key into v_stored_layout, v_stored_key
    from public.ba_prod_laptops where id = p_laptop_id for update;
  end if;
  if not found or v_stored_key <> p_idempotency_key then
    raise exception 'Laptop layout ownership is invalid.' using errcode = '22023';
  end if;
  if v_stored_layout is not null then
    if v_stored_layout <> p_layout then
      raise exception 'Spot layout conflicts with the original request.' using errcode = '23505';
    end if;
    return;
  end if;

  if p_environment = 'dev' then
    if exists (select 1 from public.ba_dev_laptop_bids where laptop_id = p_laptop_id) then
      raise exception 'A live auction layout cannot be replaced.' using errcode = '55000';
    end if;
    delete from public.ba_dev_laptop_spots where laptop_id = p_laptop_id;
    insert into public.ba_dev_laptop_spots (
      laptop_id, position, name, size, dimensions, opening_bid_cents,
      min_increment_cents, surface_position, surface_normal
    )
    select
      p_laptop_id,
      entry.ordinality::smallint,
      trim(entry.value ->> 'name'),
      entry.value ->> 'size',
      trim(entry.value ->> 'dimensions'),
      (entry.value ->> 'openingBidCents')::bigint,
      p_min_increment_cents,
      entry.value -> 'position',
      entry.value -> 'normal'
    from jsonb_array_elements(p_layout) with ordinality as entry(value, ordinality);
    update public.ba_dev_laptops
    set spot_layout = p_layout, updated_at = clock_timestamp()
    where id = p_laptop_id;
  else
    if exists (select 1 from public.ba_prod_laptop_bids where laptop_id = p_laptop_id) then
      raise exception 'A live auction layout cannot be replaced.' using errcode = '55000';
    end if;
    delete from public.ba_prod_laptop_spots where laptop_id = p_laptop_id;
    insert into public.ba_prod_laptop_spots (
      laptop_id, position, name, size, dimensions, opening_bid_cents,
      min_increment_cents, surface_position, surface_normal
    )
    select
      p_laptop_id,
      entry.ordinality::smallint,
      trim(entry.value ->> 'name'),
      entry.value ->> 'size',
      trim(entry.value ->> 'dimensions'),
      (entry.value ->> 'openingBidCents')::bigint,
      p_min_increment_cents,
      entry.value -> 'position',
      entry.value -> 'normal'
    from jsonb_array_elements(p_layout) with ordinality as entry(value, ordinality);
    update public.ba_prod_laptops
    set spot_layout = p_layout, updated_at = clock_timestamp()
    where id = p_laptop_id;
  end if;
end;
$$;

create or replace function public.ba_place_laptop_bid_internal(
  p_environment text,
  p_laptop_slug text,
  p_spot_position smallint,
  p_amount_cents bigint,
  p_bidder_name text,
  p_bidder_email text,
  p_website text,
  p_x_handle text,
  p_logo_storage_path text,
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  reason text,
  current_bid_cents bigint,
  minimum_next_bid_cents bigint,
  current_bidder_name text,
  bid_count integer,
  bid_id uuid
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_laptop public.ba_dev_laptops%rowtype;
  v_spot public.ba_dev_laptop_spots%rowtype;
  v_existing public.ba_dev_laptop_bids%rowtype;
  v_bid_id uuid;
  v_minimum_bid_cents bigint;
  v_slug text := lower(trim(p_laptop_slug));
  v_bidder_name text := trim(p_bidder_name);
  v_bidder_email text := lower(trim(p_bidder_email));
  v_website text := nullif(trim(p_website), '');
  v_x_handle text := nullif(trim(p_x_handle), '');
  v_logo_storage_path text := nullif(trim(p_logo_storage_path), '');
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'Laptop environment is invalid.' using errcode = '22023';
  end if;
  if p_spot_position not between 1 and 20
    or p_amount_cents not between 1000 and 100000000000
    or char_length(v_bidder_name) not between 1 and 80
    or char_length(v_bidder_email) not between 3 and 254 then
    raise exception 'Bid details are invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ba:' || p_environment || ':laptop-bid:' || p_idempotency_key::text,
      0
    )
  );

  if p_environment = 'dev' then
    select * into v_laptop
    from public.ba_dev_laptops
    where slug = v_slug and status = 'published';
  else
    select * into v_laptop
    from public.ba_prod_laptops
    where slug = v_slug and status = 'published';
  end if;

  if not found then
    return query select false, 'campaign_not_found'::text, 0::bigint, 0::bigint, ''::text, 0, null::uuid;
    return;
  end if;

  if p_environment = 'dev' then
    select * into v_spot
    from public.ba_dev_laptop_spots
    where laptop_id = v_laptop.id and position = p_spot_position
    for update;
  else
    select * into v_spot
    from public.ba_prod_laptop_spots
    where laptop_id = v_laptop.id and position = p_spot_position
    for update;
  end if;

  if not found then
    raise exception 'Laptop spot does not exist.' using errcode = '22023';
  end if;

  if p_environment = 'dev' then
    select * into v_existing
    from public.ba_dev_laptop_bids
    where idempotency_key = p_idempotency_key;
  else
    select * into v_existing
    from public.ba_prod_laptop_bids
    where idempotency_key = p_idempotency_key;
  end if;

  v_minimum_bid_cents := case
    when v_spot.current_bid_cents is null then v_spot.opening_bid_cents
    else v_spot.current_bid_cents + v_spot.min_increment_cents
  end;

  if found then
    if v_existing.laptop_id = v_laptop.id
      and v_existing.spot_id = v_spot.id
      and v_existing.amount_cents = p_amount_cents
      and v_existing.bidder_name = v_bidder_name
      and v_existing.bidder_email = v_bidder_email
      and v_existing.website is not distinct from v_website
      and v_existing.x_handle is not distinct from v_x_handle
      and v_existing.logo_storage_path is not distinct from v_logo_storage_path then
      return query select
        true,
        'already_processed'::text,
        coalesce(v_spot.current_bid_cents, 0),
        v_minimum_bid_cents,
        coalesce(v_spot.current_bidder_name, ''),
        v_spot.bid_count,
        v_existing.id;
    else
      return query select
        false,
        'idempotency_conflict'::text,
        coalesce(v_spot.current_bid_cents, 0),
        v_minimum_bid_cents,
        coalesce(v_spot.current_bidder_name, ''),
        v_spot.bid_count,
        null::uuid;
    end if;
    return;
  end if;

  if clock_timestamp() >= v_laptop.auction_closes_at then
    return query select
      false,
      'auction_closed'::text,
      coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents,
      coalesce(v_spot.current_bidder_name, ''),
      v_spot.bid_count,
      null::uuid;
    return;
  end if;

  if p_amount_cents < v_minimum_bid_cents then
    return query select
      false,
      'bid_too_low'::text,
      coalesce(v_spot.current_bid_cents, 0),
      v_minimum_bid_cents,
      coalesce(v_spot.current_bidder_name, ''),
      v_spot.bid_count,
      null::uuid;
    return;
  end if;

  if p_environment = 'dev' then
    insert into public.ba_dev_laptop_bids (
      laptop_id, spot_id, amount_cents, bidder_name, bidder_email,
      website, x_handle, logo_storage_path, idempotency_key
    ) values (
      v_laptop.id, v_spot.id, p_amount_cents, v_bidder_name, v_bidder_email,
      v_website, v_x_handle, v_logo_storage_path, p_idempotency_key
    ) returning id into v_bid_id;

    update public.ba_dev_laptop_spots
    set
      current_bid_cents = p_amount_cents,
      current_bidder_name = v_bidder_name,
      current_logo_storage_path = v_logo_storage_path,
      current_website = v_website,
      bid_count = public.ba_dev_laptop_spots.bid_count + 1,
      updated_at = clock_timestamp()
    where id = v_spot.id;
  else
    insert into public.ba_prod_laptop_bids (
      laptop_id, spot_id, amount_cents, bidder_name, bidder_email,
      website, x_handle, logo_storage_path, idempotency_key
    ) values (
      v_laptop.id, v_spot.id, p_amount_cents, v_bidder_name, v_bidder_email,
      v_website, v_x_handle, v_logo_storage_path, p_idempotency_key
    ) returning id into v_bid_id;

    update public.ba_prod_laptop_spots
    set
      current_bid_cents = p_amount_cents,
      current_bidder_name = v_bidder_name,
      current_logo_storage_path = v_logo_storage_path,
      current_website = v_website,
      bid_count = public.ba_prod_laptop_spots.bid_count + 1,
      updated_at = clock_timestamp()
    where id = v_spot.id;
  end if;

  return query select
    true,
    'accepted'::text,
    p_amount_cents,
    p_amount_cents + v_spot.min_increment_cents,
    v_bidder_name,
    v_spot.bid_count + 1,
    v_bid_id;
end;
$$;
