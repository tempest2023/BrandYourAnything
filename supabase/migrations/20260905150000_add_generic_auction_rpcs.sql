-- Expose auction-named RPCs now that campaigns can feature any object.
-- The private legacy implementation functions continue to own the transactional
-- logic; only the service-facing RPC contract changes in this migration.

create function public.ba_dev_create_auction(
  p_slug text,
  p_owner_name text,
  p_owner_email text,
  p_title text,
  p_tagline text,
  p_story text,
  p_object_name text,
  p_goal_cents bigint,
  p_auction_closes_at timestamptz,
  p_photo_storage_path text,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language sql
security definer
set search_path = ''
as $$
  select result.accepted, result.reason, result.laptop_id, result.laptop_slug
  from public.ba_create_laptop_internal(
    'dev', p_slug, p_owner_name, p_owner_email, p_title, p_tagline, p_story,
    p_object_name, p_goal_cents, p_auction_closes_at, p_photo_storage_path,
    p_small_opening_bid_cents, p_medium_opening_bid_cents,
    p_large_opening_bid_cents, p_min_increment_cents, p_idempotency_key
  ) as result;
$$;

create function public.ba_prod_create_auction(
  p_slug text,
  p_owner_name text,
  p_owner_email text,
  p_title text,
  p_tagline text,
  p_story text,
  p_object_name text,
  p_goal_cents bigint,
  p_auction_closes_at timestamptz,
  p_photo_storage_path text,
  p_small_opening_bid_cents bigint,
  p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint,
  p_min_increment_cents integer,
  p_idempotency_key uuid
)
returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language sql
security definer
set search_path = ''
as $$
  select result.accepted, result.reason, result.laptop_id, result.laptop_slug
  from public.ba_create_laptop_internal(
    'prod', p_slug, p_owner_name, p_owner_email, p_title, p_tagline, p_story,
    p_object_name, p_goal_cents, p_auction_closes_at, p_photo_storage_path,
    p_small_opening_bid_cents, p_medium_opening_bid_cents,
    p_large_opening_bid_cents, p_min_increment_cents, p_idempotency_key
  ) as result;
$$;

create function public.ba_dev_configure_auction_spots(
  p_auction_id uuid,
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
    'dev', p_auction_id, p_layout, p_small_opening_bid_cents,
    p_medium_opening_bid_cents, p_large_opening_bid_cents,
    p_min_increment_cents, p_idempotency_key
  );
$$;

create function public.ba_prod_configure_auction_spots(
  p_auction_id uuid,
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
    'prod', p_auction_id, p_layout, p_small_opening_bid_cents,
    p_medium_opening_bid_cents, p_large_opening_bid_cents,
    p_min_increment_cents, p_idempotency_key
  );
$$;

create function public.ba_dev_place_auction_bid(
  p_auction_slug text,
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
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_place_laptop_bid_internal(
    'dev', p_auction_slug, p_spot_position, p_amount_cents, p_bidder_name,
    p_bidder_email, p_website, p_x_handle, p_logo_storage_path,
    p_idempotency_key
  );
$$;

create function public.ba_prod_place_auction_bid(
  p_auction_slug text,
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
language sql
security definer
set search_path = ''
as $$
  select * from public.ba_place_laptop_bid_internal(
    'prod', p_auction_slug, p_spot_position, p_amount_cents, p_bidder_name,
    p_bidder_email, p_website, p_x_handle, p_logo_storage_path,
    p_idempotency_key
  );
$$;

revoke execute on function public.ba_dev_create_auction(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_create_auction(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_dev_configure_auction_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_configure_auction_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_dev_place_auction_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_place_auction_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.ba_dev_create_auction(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_prod_create_auction(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_dev_configure_auction_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_prod_configure_auction_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_dev_place_auction_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) to service_role;
grant execute on function public.ba_prod_place_auction_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) to service_role;

drop function public.ba_dev_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
);
drop function public.ba_prod_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
);
drop function public.ba_dev_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
);
drop function public.ba_prod_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
);
drop function public.ba_dev_place_laptop_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
);
drop function public.ba_prod_place_laptop_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
);
