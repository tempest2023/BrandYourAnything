-- Remove the original site's sold-out demo state from databases that applied
-- the first migration before Brand Anything switched to an empty USD starter.
-- A new installation is already empty; these statements are harmless there.

delete from public.ba_dev_bids;
delete from public.ba_prod_bids;

update public.ba_dev_spots
set
  current_bid_cents = case size when 'L' then 39000 when 'M' then 19000 else 11500 end,
  min_increment_cents = 1000,
  current_bidder_name = '',
  current_logo_url = null,
  current_website = null,
  bid_count = 0,
  updated_at = clock_timestamp();

update public.ba_prod_spots
set
  current_bid_cents = case size when 'L' then 39000 when 'M' then 19000 else 11500 end,
  min_increment_cents = 1000,
  current_bidder_name = '',
  current_logo_url = null,
  current_website = null,
  bid_count = 0,
  updated_at = clock_timestamp();
