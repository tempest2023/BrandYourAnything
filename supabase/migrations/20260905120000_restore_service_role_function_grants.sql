-- Restore the explicit RPC permissions used by the server-side Supabase client.
-- These grants are intentionally narrow: browsers still cannot call the
-- privileged campaign creation, spot configuration, or bid functions directly.

revoke execute on function public.ba_dev_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_dev_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_dev_place_laptop_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;
revoke execute on function public.ba_prod_place_laptop_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) from public, anon, authenticated;

grant execute on function public.ba_dev_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_prod_create_laptop(
  text, text, text, text, text, text, text, bigint, timestamptz,
  text, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_dev_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_prod_configure_laptop_spots(
  uuid, jsonb, bigint, bigint, bigint, integer, uuid
) to service_role;
grant execute on function public.ba_dev_place_laptop_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) to service_role;
grant execute on function public.ba_prod_place_laptop_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) to service_role;
