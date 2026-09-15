-- Paid bids use the same 20-placement limit as the current auction APIs and
-- Stripe's eight-digit USD maximum of $999,999.99.

alter table public.ba_dev_laptop_bid_payments
  drop constraint if exists ba_dev_laptop_bid_payments_spot_position_check,
  drop constraint if exists ba_prod_laptop_bid_payments_spot_position_check,
  drop constraint if exists ba_dev_laptop_bid_payments_bid_amount_cents_check,
  drop constraint if exists ba_prod_laptop_bid_payments_bid_amount_cents_check,
  add constraint ba_dev_laptop_bid_payments_spot_position_check
    check (spot_position between 1 and 20),
  add constraint ba_dev_laptop_bid_payments_bid_amount_cents_check
    check (bid_amount_cents between 1000 and 99999999);

alter table public.ba_prod_laptop_bid_payments
  drop constraint if exists ba_dev_laptop_bid_payments_spot_position_check,
  drop constraint if exists ba_prod_laptop_bid_payments_spot_position_check,
  drop constraint if exists ba_dev_laptop_bid_payments_bid_amount_cents_check,
  drop constraint if exists ba_prod_laptop_bid_payments_bid_amount_cents_check,
  add constraint ba_prod_laptop_bid_payments_spot_position_check
    check (spot_position between 1 and 20),
  add constraint ba_prod_laptop_bid_payments_bid_amount_cents_check
    check (bid_amount_cents between 1000 and 99999999);

alter table public.ba_dev_laptops
  add constraint ba_dev_laptops_stripe_opening_bid_limit_check
    check (
      small_opening_bid_cents <= 99999999
      and medium_opening_bid_cents <= 99999999
      and large_opening_bid_cents <= 99999999
    );

alter table public.ba_prod_laptops
  add constraint ba_prod_laptops_stripe_opening_bid_limit_check
    check (
      small_opening_bid_cents <= 99999999
      and medium_opening_bid_cents <= 99999999
      and large_opening_bid_cents <= 99999999
    );

alter table public.ba_dev_laptop_spots
  add constraint ba_dev_laptop_spots_stripe_opening_bid_limit_check
    check (opening_bid_cents <= 99999999);

alter table public.ba_prod_laptop_spots
  add constraint ba_prod_laptop_spots_stripe_opening_bid_limit_check
    check (opening_bid_cents <= 99999999);

-- Stripe settlement is now the only supported bid write path. Keep the old
-- functions in place for migration history, but make them uncallable even by
-- the server's service-role client.
revoke execute on function public.ba_dev_place_bid(
  smallint, bigint, text, text, text, text, text, uuid
) from service_role;
revoke execute on function public.ba_prod_place_bid(
  smallint, bigint, text, text, text, text, text, uuid
) from service_role;
revoke execute on function public.ba_dev_place_auction_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) from service_role;
revoke execute on function public.ba_prod_place_auction_bid(
  text, smallint, bigint, text, text, text, text, text, uuid
) from service_role;
