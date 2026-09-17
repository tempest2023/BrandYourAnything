-- An advertised opening price must clear the same floor the paid Checkout path
-- enforces. Without this, a creator could publish a spot whose opening bid the
-- bid API always rejects as too low, leaving a placement no one can buy.

alter table public.ba_dev_laptops
  add constraint ba_dev_laptops_payable_opening_bid_check
    check (
      small_opening_bid_cents >= 1000
      and medium_opening_bid_cents >= 1000
      and large_opening_bid_cents >= 1000
    );

alter table public.ba_dev_laptop_spots
  add constraint ba_dev_laptop_spots_payable_opening_bid_check
    check (opening_bid_cents >= 1000);

alter table public.ba_prod_laptops
  add constraint ba_prod_laptops_payable_opening_bid_check
    check (
      small_opening_bid_cents >= 1000
      and medium_opening_bid_cents >= 1000
      and large_opening_bid_cents >= 1000
    );

alter table public.ba_prod_laptop_spots
  add constraint ba_prod_laptop_spots_payable_opening_bid_check
    check (opening_bid_cents >= 1000);
