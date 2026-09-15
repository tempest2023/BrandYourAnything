-- A seller may publish several auctions through the same Stripe connected
-- account. Payment and bid rows remain isolated by laptop_id.

drop index if exists public.ba_dev_laptops_stripe_account_idx;
drop index if exists public.ba_prod_laptops_stripe_account_idx;

create index ba_dev_laptops_stripe_account_idx
  on public.ba_dev_laptops (stripe_account_id)
  where stripe_account_id is not null;

create index ba_prod_laptops_stripe_account_idx
  on public.ba_prod_laptops (stripe_account_id)
  where stripe_account_id is not null;
