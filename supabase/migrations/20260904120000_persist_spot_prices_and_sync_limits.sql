-- Persist the exact prices shown in the creation preview and finish applying
-- the widened auction amount range to every server-side bidding path.

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
  if v_count not between 4 and 10 then
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

create or replace function public.ba_place_bid_internal(
  p_environment text,
  p_spot_id smallint,
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
  v_spot public.ba_dev_spots%rowtype;
  v_existing public.ba_dev_bids%rowtype;
  v_bid_id uuid;
  v_bidder_name text := trim(p_bidder_name);
  v_bidder_email text := lower(trim(p_bidder_email));
  v_website text := nullif(trim(p_website), '');
  v_x_handle text := nullif(trim(p_x_handle), '');
  v_logo_storage_path text := nullif(trim(p_logo_storage_path), '');
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'Auction environment is invalid.' using errcode = '22023';
  end if;

  if p_amount_cents < 1000 or p_amount_cents > 100000000000 then
    raise exception 'Bid amount is outside the allowed range.' using errcode = '22023';
  end if;
  if char_length(v_bidder_name) not between 1 and 80 then
    raise exception 'Bidder name is invalid.' using errcode = '22023';
  end if;
  if char_length(v_bidder_email) not between 3 and 254 then
    raise exception 'Bidder email is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ba:' || p_environment || ':' || p_idempotency_key::text,
      0
    )
  );

  if p_environment = 'dev' then
    select *
    into v_spot
    from public.ba_dev_spots
    where public.ba_dev_spots.id = p_spot_id
    for update;
  else
    select *
    into v_spot
    from public.ba_prod_spots
    where public.ba_prod_spots.id = p_spot_id
    for update;
  end if;

  if not found then
    raise exception 'Sticker spot does not exist.' using errcode = '22023';
  end if;

  if p_environment = 'dev' then
    select *
    into v_existing
    from public.ba_dev_bids
    where public.ba_dev_bids.idempotency_key = p_idempotency_key;
  else
    select *
    into v_existing
    from public.ba_prod_bids
    where public.ba_prod_bids.idempotency_key = p_idempotency_key;
  end if;

  if found then
    if v_existing.spot_id = p_spot_id
      and v_existing.amount_cents = p_amount_cents
      and v_existing.bidder_name = v_bidder_name
      and v_existing.bidder_email = v_bidder_email
      and v_existing.website is not distinct from v_website
      and v_existing.x_handle is not distinct from v_x_handle
      and v_existing.logo_storage_path is not distinct from v_logo_storage_path then
      return query select
        true,
        'already_processed'::text,
        v_spot.current_bid_cents,
        v_spot.current_bid_cents + v_spot.min_increment_cents,
        v_spot.current_bidder_name,
        v_spot.bid_count,
        v_existing.id;
    else
      return query select
        false,
        'idempotency_conflict'::text,
        v_spot.current_bid_cents,
        v_spot.current_bid_cents + v_spot.min_increment_cents,
        v_spot.current_bidder_name,
        v_spot.bid_count,
        null::uuid;
    end if;
    return;
  end if;

  if clock_timestamp() >= v_spot.closes_at then
    return query select
      false,
      'auction_closed'::text,
      v_spot.current_bid_cents,
      v_spot.current_bid_cents + v_spot.min_increment_cents,
      v_spot.current_bidder_name,
      v_spot.bid_count,
      null::uuid;
    return;
  end if;

  if p_amount_cents < v_spot.current_bid_cents + v_spot.min_increment_cents then
    return query select
      false,
      'bid_too_low'::text,
      v_spot.current_bid_cents,
      v_spot.current_bid_cents + v_spot.min_increment_cents,
      v_spot.current_bidder_name,
      v_spot.bid_count,
      null::uuid;
    return;
  end if;

  if p_environment = 'dev' then
    insert into public.ba_dev_bids (
      spot_id, amount_cents, bidder_name, bidder_email, website,
      x_handle, logo_storage_path, idempotency_key
    )
    values (
      p_spot_id, p_amount_cents, v_bidder_name, v_bidder_email,
      v_website, v_x_handle, v_logo_storage_path, p_idempotency_key
    )
    returning public.ba_dev_bids.id into v_bid_id;

    update public.ba_dev_spots
    set
      current_bid_cents = p_amount_cents,
      current_bidder_name = v_bidder_name,
      current_logo_url = null,
      current_website = v_website,
      bid_count = public.ba_dev_spots.bid_count + 1,
      updated_at = clock_timestamp()
    where public.ba_dev_spots.id = p_spot_id;
  else
    insert into public.ba_prod_bids (
      spot_id, amount_cents, bidder_name, bidder_email, website,
      x_handle, logo_storage_path, idempotency_key
    )
    values (
      p_spot_id, p_amount_cents, v_bidder_name, v_bidder_email,
      v_website, v_x_handle, v_logo_storage_path, p_idempotency_key
    )
    returning public.ba_prod_bids.id into v_bid_id;

    update public.ba_prod_spots
    set
      current_bid_cents = p_amount_cents,
      current_bidder_name = v_bidder_name,
      current_logo_url = null,
      current_website = v_website,
      bid_count = public.ba_prod_spots.bid_count + 1,
      updated_at = clock_timestamp()
    where public.ba_prod_spots.id = p_spot_id;
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
