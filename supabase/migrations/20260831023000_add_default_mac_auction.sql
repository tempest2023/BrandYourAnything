-- Make the homepage auction a real tenant campaign in both environments.
-- Only one campaign per environment may be selected as the homepage default.

alter table public.ba_dev_laptops
  add column is_default boolean not null default false;

alter table public.ba_prod_laptops
  add column is_default boolean not null default false;

create unique index ba_dev_laptops_one_default_idx
  on public.ba_dev_laptops (is_default)
  where is_default;

create unique index ba_prod_laptops_one_default_idx
  on public.ba_prod_laptops (is_default)
  where is_default;

-- The sandbox connected account was originally attached to a temporary test
-- campaign. Move it to the durable homepage campaign instead.
update public.ba_dev_laptops
set
  stripe_account_id = null,
  stripe_charges_enabled = false,
  stripe_payouts_enabled = false,
  updated_at = clock_timestamp()
where stripe_account_id = 'acct_1U9tN5PIftpPeZXv';

update public.ba_dev_laptops set is_default = false where is_default;
update public.ba_prod_laptops set is_default = false where is_default;

insert into public.ba_dev_laptops (
  slug, owner_name, owner_email, title, tagline, story, laptop_model,
  goal_cents, small_opening_bid_cents, medium_opening_bid_cents,
  large_opening_bid_cents, min_increment_cents, auction_closes_at,
  photo_storage_path, status, idempotency_key, stripe_account_id,
  stripe_charges_enabled, stripe_payouts_enabled, is_default
) values (
  'brand-my-mac', '@biIIIionaire',
  'x-biIIIionaire@auth.brand-anything.vercel.app',
  'Your brand, on my Mac.',
  'Ten real sticker spots. One travelling MacBook. Your brand goes wherever I work.',
  'I work from cafés, meetings, events, and coworking spaces. Winning brands live on my MacBook lid, travel with me in the real world, and appear in the things I publish.',
  'MacBook Pro 14-inch',
  320000, 12500, 20000, 40000, 1000,
  clock_timestamp() + interval '30 days',
  null, 'published', 'ab32cb20-f096-4ae7-bb8b-e565296f4201',
  'acct_1U9tN5PIftpPeZXv', true, true, true
) on conflict (slug) do update set
  is_default = true,
  stripe_account_id = excluded.stripe_account_id,
  stripe_charges_enabled = excluded.stripe_charges_enabled,
  stripe_payouts_enabled = excluded.stripe_payouts_enabled,
  updated_at = clock_timestamp();

insert into public.ba_prod_laptops (
  slug, owner_name, owner_email, title, tagline, story, laptop_model,
  goal_cents, small_opening_bid_cents, medium_opening_bid_cents,
  large_opening_bid_cents, min_increment_cents, auction_closes_at,
  photo_storage_path, status, idempotency_key, stripe_account_id,
  stripe_charges_enabled, stripe_payouts_enabled, is_default
) values (
  'brand-my-mac', '@biIIIionaire',
  'x-biIIIionaire@auth.brand-anything.vercel.app',
  'Your brand, on my Mac.',
  'Ten real sticker spots. One travelling MacBook. Your brand goes wherever I work.',
  'I work from cafés, meetings, events, and coworking spaces. Winning brands live on my MacBook lid, travel with me in the real world, and appear in the things I publish.',
  'MacBook Pro 14-inch',
  320000, 12500, 20000, 40000, 1000,
  clock_timestamp() + interval '30 days',
  null, 'published', 'd1561924-4385-4ee2-9706-d72fd8e7a930',
  null, false, false, true
) on conflict (slug) do update set
  is_default = true,
  updated_at = clock_timestamp();

with default_laptop as (
  select id from public.ba_dev_laptops where is_default
)
insert into public.ba_dev_laptop_spots (
  laptop_id, position, name, size, dimensions,
  opening_bid_cents, min_increment_cents
)
select default_laptop.id, spot.position, spot.name, spot.size, spot.dimensions,
  spot.opening_bid_cents, 1000
from default_laptop
cross join (values
  (1::smallint, 'Top left banner', 'L', '9.5 × 5.5 cm', 40000::bigint),
  (2::smallint, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', 40000::bigint),
  (3::smallint, 'Top right banner', 'L', '9.5 × 5.5 cm', 40000::bigint),
  (4::smallint, 'Middle left', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (5::smallint, 'Inner left — beside the logo', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (6::smallint, 'Inner right — beside the logo', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (7::smallint, 'Middle right', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (8::smallint, 'Bottom left strip', 'M', '9.5 × 4 cm', 20000::bigint),
  (9::smallint, 'Bottom center — under the logo', 'M', '9.5 × 4 cm', 20000::bigint),
  (10::smallint, 'Bottom right strip', 'M', '9.5 × 4 cm', 20000::bigint)
) as spot(position, name, size, dimensions, opening_bid_cents)
on conflict (laptop_id, position) do nothing;

with default_laptop as (
  select id from public.ba_prod_laptops where is_default
)
insert into public.ba_prod_laptop_spots (
  laptop_id, position, name, size, dimensions,
  opening_bid_cents, min_increment_cents
)
select default_laptop.id, spot.position, spot.name, spot.size, spot.dimensions,
  spot.opening_bid_cents, 1000
from default_laptop
cross join (values
  (1::smallint, 'Top left banner', 'L', '9.5 × 5.5 cm', 40000::bigint),
  (2::smallint, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', 40000::bigint),
  (3::smallint, 'Top right banner', 'L', '9.5 × 5.5 cm', 40000::bigint),
  (4::smallint, 'Middle left', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (5::smallint, 'Inner left — beside the logo', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (6::smallint, 'Inner right — beside the logo', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (7::smallint, 'Middle right', 'S', '4.5 × 4.5 cm', 12500::bigint),
  (8::smallint, 'Bottom left strip', 'M', '9.5 × 4 cm', 20000::bigint),
  (9::smallint, 'Bottom center — under the logo', 'M', '9.5 × 4 cm', 20000::bigint),
  (10::smallint, 'Bottom right strip', 'M', '9.5 × 4 cm', 20000::bigint)
) as spot(position, name, size, dimensions, opening_bid_cents)
on conflict (laptop_id, position) do nothing;
