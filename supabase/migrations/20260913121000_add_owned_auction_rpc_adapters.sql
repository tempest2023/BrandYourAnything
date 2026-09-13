-- Expose an auction-named contract while retaining the historical physical schema.

create or replace function public.ba_dev_create_owned_auction(
  p_slug text, p_owner_user_id uuid, p_manager_key_hash text,
  p_owner_name text, p_owner_email text, p_title text, p_tagline text,
  p_story text, p_object_name text, p_goal_cents bigint,
  p_auction_closes_at timestamptz, p_photo_storage_path text,
  p_small_opening_bid_cents bigint, p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint, p_min_increment_cents integer, p_idempotency_key uuid
) returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language sql security definer set search_path = ''
as $$
  select accepted, reason, laptop_id, laptop_slug
  from public.ba_create_owned_laptop_internal(
    'dev', p_slug, p_owner_user_id, p_manager_key_hash, p_owner_name, p_owner_email,
    p_title, p_tagline, p_story, p_object_name, p_goal_cents, p_auction_closes_at,
    p_photo_storage_path, p_small_opening_bid_cents, p_medium_opening_bid_cents,
    p_large_opening_bid_cents, p_min_increment_cents, p_idempotency_key
  );
$$;
revoke all on function public.ba_dev_create_owned_auction(text, uuid, text, text, text, text, text, text, text, bigint, timestamptz, text, bigint, bigint, bigint, integer, uuid) from public, anon, authenticated;
grant execute on function public.ba_dev_create_owned_auction(text, uuid, text, text, text, text, text, text, text, bigint, timestamptz, text, bigint, bigint, bigint, integer, uuid) to service_role;

create or replace function public.ba_prod_create_owned_auction(
  p_slug text, p_owner_user_id uuid, p_manager_key_hash text,
  p_owner_name text, p_owner_email text, p_title text, p_tagline text,
  p_story text, p_object_name text, p_goal_cents bigint,
  p_auction_closes_at timestamptz, p_photo_storage_path text,
  p_small_opening_bid_cents bigint, p_medium_opening_bid_cents bigint,
  p_large_opening_bid_cents bigint, p_min_increment_cents integer, p_idempotency_key uuid
) returns table (accepted boolean, reason text, auction_id uuid, auction_slug text)
language sql security definer set search_path = ''
as $$
  select accepted, reason, laptop_id, laptop_slug
  from public.ba_create_owned_laptop_internal(
    'prod', p_slug, p_owner_user_id, p_manager_key_hash, p_owner_name, p_owner_email,
    p_title, p_tagline, p_story, p_object_name, p_goal_cents, p_auction_closes_at,
    p_photo_storage_path, p_small_opening_bid_cents, p_medium_opening_bid_cents,
    p_large_opening_bid_cents, p_min_increment_cents, p_idempotency_key
  );
$$;
revoke all on function public.ba_prod_create_owned_auction(text, uuid, text, text, text, text, text, text, text, bigint, timestamptz, text, bigint, bigint, bigint, integer, uuid) from public, anon, authenticated;
grant execute on function public.ba_prod_create_owned_auction(text, uuid, text, text, text, text, text, text, text, bigint, timestamptz, text, bigint, bigint, bigint, integer, uuid) to service_role;
