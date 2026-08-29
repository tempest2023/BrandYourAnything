# Brand Anything

An open-source Next.js 16 template for auctioning brand placements, backed by Supabase Postgres and Storage. The included MacBook campaign is a starting point: fork it, replace the object and owner story, and launch your own version.

## Starter state

The repository intentionally starts before the first bid:

- all ten spots are available and no sponsor logos are prefilled;
- bid history and amount raised both start at zero;
- bids are stored and settled in US dollars, with an optional indicative euro display;
- opening bids are $125 for Small, $200 for Medium, and $400 for Large spots;
- Final Look preloads the device image and every active sponsor image, then reveals the composition as one complete view.

The migration `20260828225000_reset_auction_to_empty_usd_state.sql` removes the original sold-out demo bids from databases that applied an earlier version of the initial migration. Review that reset before applying migrations to any environment containing data you intend to keep.

## Backend design

The database intentionally has only two application tables per environment:

- `ba_<env>_spots` stores the ten auction slots and their current winning state.
- `ba_<env>_bids` is an append-only bid ledger. Bidder emails and private logo paths are never returned by the public API.

`ba_dev_*` and `ba_prod_*` can safely share a Supabase project with each other and with unrelated applications. `SUPABASE_DATABASE_PREFIX` selects the environment. Production uses `ba_prod`; local development and Vercel previews use `ba_dev`.

All writes go through `public.ba_<env>_place_bid(...)`. The function takes a PostgreSQL row lock on the selected spot, re-checks the latest minimum, inserts the bid, and updates the winner inside one transaction. An advisory transaction lock plus a unique key makes retries idempotent, including accidental key reuse across different spots.

The browser only talks to the Next.js Route Handlers:

- `GET /api/auction` returns public spots and recent bid history.
- `POST /api/bids` validates multipart form data, stores an optional logo in the private `ba_<env>_bid_logos` bucket, and calls the atomic database function.

Supabase secret keys are server-only. The `anon` and `authenticated` roles have no direct access to the auction tables or bid function.

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
```

The test verifies equal concurrent bids, simultaneous retries, and idempotency-key reuse across different spots.

## Production setup

1. Create or select a Supabase project.
2. Run `supabase link --project-ref <project-ref>`.
3. Preview with `supabase db push --dry-run`, then apply with `supabase db push`.
4. Add `SUPABASE_URL` and `SUPABASE_SECRET_KEY` to the Vercel project for Production, Preview, and Development.
5. Set `SUPABASE_DATABASE_PREFIX=ba_prod` for Production and `SUPABASE_DATABASE_PREFIX=ba_dev` for Preview and Development.
6. Deploy the Next.js application.

Never commit `.env.local` or expose the Supabase secret key with a `NEXT_PUBLIC_` prefix.
