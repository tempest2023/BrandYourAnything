# Brand Anything

An open-source Next.js 16 platform for auctioning brand placements, backed by Supabase Postgres and private Storage. Visitors can use the included MacBook campaign or publish an isolated 10-spot laptop auction at `/create` without forking the repository.

<a href="https://www.buymeacoffee.com/tempes666" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" alt="Buy Me A Coffee"></a>

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftempest2023%2FBrandYourAnything&env=SUPABASE_URL%2CSUPABASE_SECRET_KEY&envDescription=Enter%20the%20Project%20URL%20and%20server-only%20Secret%20key%20from%20your%20Supabase%20project.%20Apply%20the%20database%20migrations%20before%20using%20the%20app.&envLink=https%3A%2F%2Fgithub.com%2Ftempest2023%2FBrandYourAnything%2Fblob%2Fmain%2FREADME.md%23production-deployment&project-name=brand-anything&repository-name=brand-anything)

## Production deployment

The Vercel button creates and deploys the web application, but it cannot apply the Supabase database migrations for you. Set up Supabase first, then create the Vercel project.

### 1. Create a Supabase project

1. Sign in to the [Supabase Dashboard](https://supabase.com/dashboard) and select **New project**.
2. Choose an organization, enter a project name, and generate a strong database password. Save the password in a password manager; the Supabase CLI may ask for it when linking the project.
3. Select a region close to the majority of your users and, when possible, to the region where your Vercel Functions will run.
4. Select a plan, create the project, and wait until the database reports that it is ready.

A new or dedicated project is recommended. The repository migrations own tables, functions, and Storage buckets whose names begin with `ba_dev_` or `ba_prod_`.

### 2. Get the Supabase connection values

Open the project's **Connect** dialog or go to **Project Settings > API Keys**. Copy these values and keep them available for the Vercel setup:

| Vercel variable | Supabase value | Example |
| --- | --- | --- |
| `SUPABASE_URL` | Project URL | `https://your-project-ref.supabase.co` |
| `SUPABASE_SECRET_KEY` | A server-side Secret key | `sb_secret_...` |

Use a Secret key, not a Publishable key. Secret keys have elevated access and bypass Row Level Security, so never commit one, expose it to browser code, or prefix its variable with `NEXT_PUBLIC_`. If a legacy project has only a `service_role` key, set it as `SUPABASE_SERVICE_ROLE_KEY` instead; the application supports that fallback.

Also copy the project reference. It is the `<project-ref>` segment in the dashboard URL:

```text
https://supabase.com/dashboard/project/<project-ref>
```

See [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys) for the current key types and security guidance.

### 3. Configure the Supabase backend

Clone the repository, authenticate the [Supabase CLI](https://supabase.com/docs/reference/cli/getting-started), and link the local directory to the new hosted project:

```bash
git clone https://github.com/tempest2023/BrandYourAnything.git
cd BrandYourAnything
npx supabase login
npx supabase link --project-ref <project-ref>
```

Preview the pending migrations before changing the remote database:

```bash
npx supabase db push --dry-run
```

Review the listed migration files, then apply them:

```bash
npx supabase db push
```

The migrations provision both isolated namespaces in one Supabase project:

- `ba_prod_*` tables and database functions for the production deployment;
- `ba_dev_*` tables and database functions for local and preview deployments;
- private `ba_prod_*` and `ba_dev_*` Storage buckets for logos and laptop images;
- initial auction spots, Row Level Security, grants, and atomic bidding functions.

Do not create these tables or buckets manually, and do not run `supabase db reset --linked` against production; a linked reset erases the remote database. Future schema updates are deployed by running `npx supabase db push` again. Supabase records applied migrations and skips them on later pushes. See the official [migration deployment workflow](https://supabase.com/docs/guides/local-development/cli-workflows) for details.

### 4. Create and configure the Vercel project

Either click the **Deploy with Vercel** button above or import the repository manually from the [Vercel Dashboard](https://vercel.com/new):

1. Select **Add New > Project** and import your fork or the Git repository created by the deploy button.
2. Keep **Next.js** as the detected Framework Preset.
3. Keep the repository root as the Root Directory and use the default install, build, and output settings.
4. Before deploying, add the environment variables below. If the deploy button already added the Supabase URL and Secret key, verify their values and environment scopes.

In **Project Settings > Environment Variables**, configure:

| Name | Value | Vercel environments |
| --- | --- | --- |
| `SUPABASE_URL` | The Supabase Project URL | Production, Preview, Development |
| `SUPABASE_SECRET_KEY` | The Supabase `sb_secret_...` key | Production, Preview, Development |
| `SUPABASE_DATABASE_PREFIX` | `ba_prod` | Production only |
| `SUPABASE_DATABASE_PREFIX` | `ba_dev` | Preview and Development only |

Add `SUPABASE_DATABASE_PREFIX` twice with the environment scopes shown above. This keeps preview bids and test campaigns out of the production tables. The variable is optional on Vercel because the application falls back to `ba_prod` when `VERCEL_ENV=production` and `ba_dev` otherwise, but setting it explicitly makes the isolation visible in the project configuration.

Treat `SUPABASE_SECRET_KEY` as a sensitive value if the Vercel UI offers that option. Environment-variable changes only affect new deployments, so redeploy the project after adding, editing, or rotating any value. See [Vercel's environment-variable guide](https://vercel.com/docs/environment-variables/managing-environment-variables) for the current dashboard flow.

### 5. Deploy and verify

1. Select **Deploy**. Vercel should detect Next.js and run `npm run build`.
2. Open the generated URL and confirm that the homepage loads without a Supabase configuration error.
3. Open `/create`, publish a test campaign, and place a test bid. Use a Preview deployment for testing so the records go to the `ba_dev_*` namespace.
4. In Supabase, use **Table Editor** to confirm the new record and **Storage** to confirm uploaded images are in the matching private bucket.
5. When ready, merge or push to the Vercel Production Branch, normally `main`. Vercel will create the Production deployment using `ba_prod`.

For failures, first check the Vercel deployment and Function logs, confirm all variables are assigned to the correct environment, and verify that `npx supabase db push` completed successfully. Never print the Secret key into logs while troubleshooting.

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
