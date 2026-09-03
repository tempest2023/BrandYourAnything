-- Widen price limits and update slug pattern to support high-value items
-- (Private Jets, Yachts) and allow underscores in slugs.

-- ============================================================
-- 1. ba_dev_laptops — drop and re-add CHECK constraints
-- ============================================================

alter table public.ba_dev_laptops
  drop constraint if exists ba_dev_laptops_goal_cents_check,
  drop constraint if exists ba_dev_laptops_small_opening_bid_cents_check,
  drop constraint if exists ba_dev_laptops_medium_opening_bid_cents_check,
  drop constraint if exists ba_dev_laptops_large_opening_bid_cents_check,
  drop constraint if exists ba_dev_laptops_slug_check,
  drop constraint if exists ba_dev_laptops_slug_check1;

alter table public.ba_dev_laptops
  add constraint ba_dev_laptops_goal_cents_check
    check (goal_cents between 100 and 100000000000),
  add constraint ba_dev_laptops_small_opening_bid_cents_check
    check (small_opening_bid_cents between 100 and 100000000000),
  add constraint ba_dev_laptops_medium_opening_bid_cents_check
    check (medium_opening_bid_cents between 100 and 100000000000),
  add constraint ba_dev_laptops_large_opening_bid_cents_check
    check (large_opening_bid_cents between 100 and 100000000000),
  add constraint ba_dev_laptops_slug_check
    check (char_length(slug) between 3 and 48),
  add constraint ba_dev_laptops_slug_check1
    check (slug ~ '^[a-z0-9](?:[a-z0-9_-]{1,46}[a-z0-9_-])$');

-- ============================================================
-- 2. ba_prod_laptops — same changes
-- ============================================================

alter table public.ba_prod_laptops
  drop constraint if exists ba_prod_laptops_goal_cents_check,
  drop constraint if exists ba_prod_laptops_small_opening_bid_cents_check,
  drop constraint if exists ba_prod_laptops_medium_opening_bid_cents_check,
  drop constraint if exists ba_prod_laptops_large_opening_bid_cents_check,
  drop constraint if exists ba_prod_laptops_slug_check,
  drop constraint if exists ba_prod_laptops_slug_check1;

alter table public.ba_prod_laptops
  add constraint ba_prod_laptops_goal_cents_check
    check (goal_cents between 100 and 100000000000),
  add constraint ba_prod_laptops_small_opening_bid_cents_check
    check (small_opening_bid_cents between 100 and 100000000000),
  add constraint ba_prod_laptops_medium_opening_bid_cents_check
    check (medium_opening_bid_cents between 100 and 100000000000),
  add constraint ba_prod_laptops_large_opening_bid_cents_check
    check (large_opening_bid_cents between 100 and 100000000000),
  add constraint ba_prod_laptops_slug_check
    check (char_length(slug) between 3 and 48),
  add constraint ba_prod_laptops_slug_check1
    check (slug ~ '^[a-z0-9](?:[a-z0-9_-]{1,46}[a-z0-9_-])$');

-- ============================================================
-- 3. ba_create_laptop_internal — update function with new ranges
-- ============================================================

create or replace function public.ba_create_laptop_internal(
  p_environment text,
  p_slug text,
  p_owner_name text,
  p_owner_email text,
  p_title text,
  p_tagline text,
  p_story text,
  p_laptop_model text,
  p_goal_cents bigint,
  p_auction_closes_at timestamptz,
  p_photo_storage_path text,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns table (
  accepted boolean,
  reason text,
  laptop_id uuid,
  laptop_slug text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_existing public.ba_dev_laptops%rowtype;
  v_laptop_id uuid;
  v_owner_count integer;
  v_slug text := lower(trim(p_slug));
  v_owner_name text := trim(p_owner_name);
  v_owner_email text := lower(trim(p_owner_email));
  v_title text := trim(p_title);
  v_tagline text := trim(p_tagline);
  v_story text := trim(p_story);
  v_laptop_model text := trim(p_laptop_model);
  v_photo_storage_path text := nullif(trim(p_photo_storage_path), '');
begin
  if p_environment not in ('dev', 'prod') then
    raise exception 'Laptop environment is invalid.' using errcode = '22023';
  end if;
  if v_slug !~ '^[a-z0-9](?:[a-z0-9_-]{1,46}[a-z0-9_-])$' then
    raise exception 'Laptop slug is invalid.' using errcode = '22023';
  end if;
  if char_length(v_owner_name) not between 2 and 80
    or char_length(v_owner_email) not between 3 and 254
    or char_length(v_title) not between 3 and 80
    or char_length(v_tagline) not between 3 and 160
    or char_length(v_story) not between 20 and 1200
    or char_length(v_laptop_model) not between 2 and 100 then
    raise exception 'Laptop details are invalid.' using errcode = '22023';
  end if;
  if p_goal_cents not between 100 and 100000000000
    or p_small_opening_bid_cents not between 100 and 100000000000
    or p_medium_opening_bid_cents not between 100 and 100000000000
    or p_large_opening_bid_cents not between 100 and 100000000000
    or p_min_increment_cents not between 100 and 1000000 then
    raise exception 'Laptop pricing is invalid.' using errcode = '22023';
  end if;
  if p_auction_closes_at <= clock_timestamp() + interval '1 hour'
    or p_auction_closes_at > clock_timestamp() + interval '90 days' then
    raise exception 'Auction close time is invalid.' using errcode = '22023';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended(
      'ba:' || p_environment || ':create:' || p_idempotency_key::text,
      0
    )
  );

  if p_environment = 'dev' then
    select * into v_existing
    from public.ba_dev_laptops
    where public.ba_dev_laptops.idempotency_key = p_idempotency_key;
  else
    select * into v_existing
    from public.ba_prod_laptops
    where public.ba_prod_laptops.idempotency_key = p_idempotency_key;
  end if;

  if found then
    if v_existing.slug = v_slug
      and v_existing.owner_name = v_owner_name
      and v_existing.owner_email = v_owner_email
      and v_existing.title = v_title
      and v_existing.tagline = v_tagline
      and v_existing.story = v_story
      and v_existing.laptop_model = v_laptop_model
      and v_existing.goal_cents = p_goal_cents
      and v_existing.small_opening_bid_cents = p_small_opening_bid_cents
      and v_existing.medium_opening_bid_cents = p_medium_opening_bid_cents
      and v_existing.large_opening_bid_cents = p_large_opening_bid_cents
      and v_existing.min_increment_cents = p_min_increment_cents
      and v_existing.auction_closes_at = p_auction_closes_at
      and v_existing.photo_storage_path is not distinct from v_photo_storage_path then
      return query select true, 'already_processed'::text, v_existing.id, v_existing.slug;
    else
      return query select false, 'idempotency_conflict'::text, null::uuid, v_slug;
    end if;
    return;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('ba:' || p_environment || ':slug:' || v_slug, 0)
  );

  if p_environment = 'dev' then
    select * into v_existing
    from public.ba_dev_laptops
    where public.ba_dev_laptops.slug = v_slug;
  else
    select * into v_existing
    from public.ba_prod_laptops
    where public.ba_prod_laptops.slug = v_slug;
  end if;

  if found then
    return query select false, 'slug_taken'::text, v_existing.id, v_existing.slug;
    return;
  end if;

  if p_environment = 'dev' then
    select count(*)::integer into v_owner_count
    from public.ba_dev_laptops
    where owner_email = v_owner_email
      and created_at > clock_timestamp() - interval '1 hour';
  else
    select count(*)::integer into v_owner_count
    from public.ba_prod_laptops
    where owner_email = v_owner_email
      and created_at > clock_timestamp() - interval '1 hour';
  end if;

  if v_owner_count >= 3 then
    return query select false, 'rate_limited'::text, null::uuid, v_slug;
    return;
  end if;

  if p_environment = 'dev' then
    insert into public.ba_dev_laptops (
      slug, owner_name, owner_email, title, tagline, story, laptop_model,
      goal_cents, small_opening_bid_cents, medium_opening_bid_cents,
      large_opening_bid_cents, min_increment_cents, auction_closes_at,
      photo_storage_path, idempotency_key
    ) values (
      v_slug, v_owner_name, v_owner_email, v_title, v_tagline, v_story,
      v_laptop_model, p_goal_cents, p_small_opening_bid_cents,
      p_medium_opening_bid_cents, p_large_opening_bid_cents,
      p_min_increment_cents, p_auction_closes_at,
      v_photo_storage_path, p_idempotency_key
    ) returning id into v_laptop_id;

    insert into public.ba_dev_laptop_spots (
      laptop_id, position, name, size, dimensions,
      opening_bid_cents, min_increment_cents
    ) values
      (v_laptop_id, 1, 'Top left banner', 'L', '9.5 × 5.5 cm', p_large_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 2, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', p_large_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 3, 'Top right banner', 'L', '9.5 × 5.5 cm', p_large_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 4, 'Middle left', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 5, 'Inner left — beside the logo', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 6, 'Inner right — beside the logo', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 7, 'Middle right', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 8, 'Bottom left strip', 'M', '9.5 × 4 cm', p_medium_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 9, 'Bottom center — under the logo', 'M', '9.5 × 4 cm', p_medium_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 10, 'Bottom right strip', 'M', '9.5 × 4 cm', p_medium_opening_bid_cents, p_min_increment_cents);
  else
    insert into public.ba_prod_laptops (
      slug, owner_name, owner_email, title, tagline, story, laptop_model,
      goal_cents, small_opening_bid_cents, medium_opening_bid_cents,
      large_opening_bid_cents, min_increment_cents, auction_closes_at,
      photo_storage_path, idempotency_key
    ) values (
      v_slug, v_owner_name, v_owner_email, v_title, v_tagline, v_story,
      v_laptop_model, p_goal_cents, p_small_opening_bid_cents,
      p_medium_opening_bid_cents, p_large_opening_bid_cents,
      p_min_increment_cents, p_auction_closes_at,
      v_photo_storage_path, p_idempotency_key
    ) returning id into v_laptop_id;

    insert into public.ba_prod_laptop_spots (
      laptop_id, position, name, size, dimensions,
      opening_bid_cents, min_increment_cents
    ) values
      (v_laptop_id, 1, 'Top left banner', 'L', '9.5 × 5.5 cm', p_large_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 2, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', p_large_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 3, 'Top right banner', 'L', '9.5 × 5.5 cm', p_large_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 4, 'Middle left', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 5, 'Inner left — beside the logo', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 6, 'Inner right — beside the logo', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 7, 'Middle right', 'S', '4.5 × 4.5 cm', p_small_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 8, 'Bottom left strip', 'M', '9.5 × 4 cm', p_medium_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 9, 'Bottom center — under the logo', 'M', '9.5 × 4 cm', p_medium_opening_bid_cents, p_min_increment_cents),
      (v_laptop_id, 10, 'Bottom right strip', 'M', '9.5 × 4 cm', p_medium_opening_bid_cents, p_min_increment_cents);
  end if;

  return query select true, 'created'::text, v_laptop_id, v_slug;
end;
$$;

-- ============================================================
-- 4. ba_place_laptop_bid_internal — widen bid amount range
-- ============================================================

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
  if p_spot_position not between 1 and 10
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
