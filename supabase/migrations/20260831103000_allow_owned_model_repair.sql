-- The owner-only model repair endpoint may replace a missing or incorrect
-- campaign asset before an auction has received any bids.

grant update on table public.ba_dev_campaign_assets to service_role;
grant update on table public.ba_prod_campaign_assets to service_role;
