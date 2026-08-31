-- Persist user-authored 3D brand placements and allow Brand Anything campaigns
-- to use a model-specific number of spots instead of the legacy 6/10 layouts.

alter table public.ba_dev_laptops add column spot_layout jsonb;
alter table public.ba_prod_laptops add column spot_layout jsonb;

alter table public.ba_dev_laptop_spots
  add column surface_position jsonb,
  add column surface_normal jsonb,
  add constraint ba_dev_laptop_spots_surface_position_check check (
    surface_position is null or (
      jsonb_typeof(surface_position) = 'array'
      and jsonb_array_length(surface_position) = 3
    )
  ),
  add constraint ba_dev_laptop_spots_surface_normal_check check (
    surface_normal is null or (
      jsonb_typeof(surface_normal) = 'array'
      and jsonb_array_length(surface_normal) = 3
    )
  );
alter table public.ba_prod_laptop_spots
  add column surface_position jsonb,
  add column surface_normal jsonb,
  add constraint ba_prod_laptop_spots_surface_position_check check (
    surface_position is null or (
      jsonb_typeof(surface_position) = 'array'
      and jsonb_array_length(surface_position) = 3
    )
  ),
  add constraint ba_prod_laptop_spots_surface_normal_check check (
    surface_normal is null or (
      jsonb_typeof(surface_normal) = 'array'
      and jsonb_array_length(surface_normal) = 3
    )
  );

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
  if p_small_opening_bid_cents not between 1000 and 10000000
    or p_medium_opening_bid_cents not between 1000 and 10000000
    or p_large_opening_bid_cents not between 1000 and 10000000
    or p_min_increment_cents not between 100 and 1000000 then
    raise exception 'Spot pricing is invalid.' using errcode = '22023';
  end if;

  select bool_and(
    (entry.value ->> 'id')::integer = entry.ordinality
    and entry.value ->> 'size' in ('S', 'M', 'L')
    and char_length(trim(entry.value ->> 'name')) between 2 and 80
    and char_length(trim(entry.value ->> 'dimensions')) between 2 and 100
    and (
      entry.value -> 'position' is null
      or (jsonb_typeof(entry.value -> 'position') = 'array' and jsonb_array_length(entry.value -> 'position') = 3)
    )
    and (
      entry.value -> 'normal' is null
      or (jsonb_typeof(entry.value -> 'normal') = 'array' and jsonb_array_length(entry.value -> 'normal') = 3)
    )
  ) into v_valid
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
      case entry.value ->> 'size'
        when 'L' then p_large_opening_bid_cents
        when 'M' then p_medium_opening_bid_cents
        else p_small_opening_bid_cents
      end,
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
      case entry.value ->> 'size'
        when 'L' then p_large_opening_bid_cents
        when 'M' then p_medium_opening_bid_cents
        else p_small_opening_bid_cents
      end,
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

create or replace function public.ba_dev_configure_laptop_spots(
  p_laptop_id uuid,
  p_layout jsonb,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.ba_configure_laptop_spots_internal(
    'dev', p_laptop_id, p_layout, p_small_opening_bid_cents,
    p_medium_opening_bid_cents, p_large_opening_bid_cents,
    p_min_increment_cents, p_idempotency_key
  );
$$;

create or replace function public.ba_prod_configure_laptop_spots(
  p_laptop_id uuid,
  p_layout jsonb,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns void
language sql
security definer
set search_path = ''
as $$
  select public.ba_configure_laptop_spots_internal(
    'prod', p_laptop_id, p_layout, p_small_opening_bid_cents,
    p_medium_opening_bid_cents, p_large_opening_bid_cents,
    p_min_increment_cents, p_idempotency_key
  );
$$;

revoke all on function public.ba_configure_laptop_spots_internal(
  text, uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated, service_role;
revoke all on function public.ba_dev_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke all on function public.ba_prod_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
grant execute on function public.ba_dev_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_prod_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) to service_role;
