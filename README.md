# Brand Anything

An open-source Next.js 16 platform for auctioning brand placements, backed by Supabase Postgres and private Storage. Visitors can use the included MacBook campaign or publish an isolated 10-spot laptop auction at `/create` without forking the repository.

## Starter state

The repository intentionally starts before the first bid:

- all ten spots are available and no sponsor logos are prefilled;
- bid history and amount raised both start at zero;
- bids are stored and settled in US dollars, with optional indicative EUR and RMB displays;
- opening bids are $125 for Small, $200 for Medium, and $400 for Large spots;
- Final Look preloads the device image and every active sponsor image, then reveals the composition as one complete view.

The migration `20260828225000_reset_auction_to_empty_usd_state.sql` removes the original sold-out demo bids from databases that applied an earlier version of the initial migration. Review that reset before applying migrations to any environment containing data you intend to keep.

## Languages and currencies

The homepage, campaign creator, and published laptop pages support English, Simplified Chinese, and Spanish. Language and display-currency choices are stored as first-party preference cookies and follow the visitor between routes.

USD is the default and the canonical auction currency. The database and Route Handlers continue to read and write integer USD cents; EUR and RMB (ISO currency code `CNY`) are display and input conversions only. Creation and bid forms convert the visitor's selected currency back to USD cents before submission. The fixed indicative rates live in `lib/money.ts` and should be updated or replaced with a live rate provider if a deployment needs financial-grade conversion.

## Multi-tenant laptop flow

`POST /api/laptops` validates the multipart creation form, stores an optional laptop photo privately, and creates the campaign plus all ten spots in one database transaction. Each campaign is published at `/laptop/<slug>` and exposes only public fields.

Every environment adds three compact tables:

- `ba_<env>_laptops` stores the campaign, owner contact, deadline, pricing policy, and private photo path.
- `ba_<env>_laptop_spots` stores the ten positions and their current winning state.
- `ba_<env>_laptop_bids` is the append-only bid ledger.

The owner email, bidder emails, and Storage paths are never returned by the public API. Public images use short-lived signed URLs. `anon` and `authenticated` have no direct access to the tables, buckets, or write functions.

Creation goes through `ba_<env>_create_laptop(...)`. It uses advisory locks for slug and idempotency races, creates the laptop and ten spots atomically, and applies a small per-email creation limit. Tenant bids go through `ba_<env>_place_laptop_bid(...)`; it locks the exact campaign spot, re-checks the live minimum, appends the bid, and updates the winner in one transaction. Idempotency keys make network retries safe.

The browser only calls Next.js Route Handlers:

- `POST /api/laptops` publishes a campaign.
- `GET /api/laptops/<slug>` returns its public snapshot.
- `POST /api/laptops/<slug>/bids` places a concurrency-safe bid and optionally stores a private logo.

## Included starter auction

The original single-laptop homepage remains available and uses two application tables per environment:

- `ba_<env>_spots` stores the ten auction slots and their current winning state.
- `ba_<env>_bids` is an append-only bid ledger. Bidder emails and private logo paths are never returned by the public API.

`ba_dev_*` and `ba_prod_*` can safely share a Supabase project with each other and with unrelated applications. `SUPABASE_DATABASE_PREFIX` selects the environment. Production uses `ba_prod`; local development and Vercel previews use `ba_dev`.

All writes go through `public.ba_<env>_place_bid(...)`. The function takes a PostgreSQL row lock on the selected spot, re-checks the latest minimum, inserts the bid, and updates the winner inside one transaction. An advisory transaction lock plus a unique key makes retries idempotent, including accidental key reuse across different spots.

Its browser flow uses these Route Handlers:

- `GET /api/auction` returns public spots and recent bid history.
- `POST /api/bids` validates multipart form data, stores an optional logo in the private `ba_<env>_bid_logos` bucket, and calls the atomic database function.

Supabase secret keys are server-only for both flows.

## Local development

Requirements: Node.js 20+, Docker, and the Supabase CLI.

```bash
npm install
supabase start
supabase status -o env
```

Create `.env.local` using the local output:

```dotenv
SUPABASE_URL=http://127.0.0.1:54321
SUPABASE_SECRET_KEY=<the local SECRET_KEY value>
SUPABASE_DATABASE_PREFIX=ba_dev
```

Then start Next.js:

```bash
npm run dev
```

Reset the local database and replay all migrations:

```bash
supabase db reset
```

Run the real concurrency test against local Postgres:

```bash
npm run test:concurrency
npm run test:laptop-platform
```

The platform test verifies atomic campaign creation, ten-spot isolation, RLS, equal concurrent bids, simultaneous retries, and cross-tenant idempotency-key reuse. Run it once with `SUPABASE_DATABASE_PREFIX=ba_dev` and once with `ba_prod` when validating both namespaces.

## Production setup

1. Create or select a Supabase project.
2. Run `supabase link --project-ref <project-ref>`.
3. Preview with `supabase db push --dry-run`, then apply with `supabase db push`.
4. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the Vercel project for Production, Preview, and Development.
5. Set `SUPABASE_DATABASE_PREFIX=ba_prod` for Production and `SUPABASE_DATABASE_PREFIX=ba_dev` for Preview and Development.
6. Deploy the Next.js application.

Never commit `.env.local` or expose the Supabase secret key with a `NEXT_PUBLIC_` prefix.
