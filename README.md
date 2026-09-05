# Brand Anything

An open-source Next.js 16 platform for auctioning brand placements on almost anything, backed by Supabase Postgres, Auth, and private Storage. A creator can upload a ready-made GLB for a car, boat, aircraft, instrument, robot, or other object and publish its interactive 3D auction at `/sell` (`/create` remains an alias). The original Mac and PC lid flow remains available.

<a href="https://www.buymeacoffee.com/tempes666" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" alt="Buy Me A Coffee"></a>

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftempest2023%2FBrandYourAnything&env=SUPABASE_URL%2CSUPABASE_SECRET_KEY%2CNEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CNEXT_PUBLIC_SITE_URL&envDescription=Enter%20the%20Supabase%20credentials%20and%20the%20public%20site%20URL.%20Apply%20the%20database%20migrations%20before%20using%20the%20app.&envLink=https%3A%2F%2Fgithub.com%2Ftempest2023%2FBrandYourAnything%2Fblob%2Fmain%2FREADME.md%23production-deployment&project-name=brand-anything&repository-name=brand-anything)

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
| `NEXT_PUBLIC_SUPABASE_URL` | Project URL | `https://your-project-ref.supabase.co` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | A browser-safe Publishable key | `sb_publishable_...` |
| `NEXT_PUBLIC_SITE_URL` | Public site origin | `https://brand-anything.vercel.app` |

The Publishable key is intended for browser Auth. The Secret key has elevated access and bypasses Row Level Security, so never commit it, expose it to browser code, or prefix it with `NEXT_PUBLIC_`. If a legacy project has only a `service_role` and `anon` key, set them as `SUPABASE_SERVICE_ROLE_KEY` and `NEXT_PUBLIC_SUPABASE_ANON_KEY`; the application supports both fallbacks.

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
- private `ba_prod_*` and `ba_dev_*` Storage buckets for logos, laptop images, and Brand Anything GLB models;
- initial auction spots, Row Level Security, grants, and atomic bidding functions.

Do not create these tables or buckets manually, and do not run `supabase db reset --linked` against production; a linked reset erases the remote database. Future schema updates are deployed by running `npx supabase db push` again. Supabase records applied migrations and skips them on later pushes. See the official [migration deployment workflow](https://supabase.com/docs/guides/local-development/cli-workflows) for details.

### 4. Configure X sign in

When X / Twitter OAuth 2.0 is configured, `POST /api/auctions` sends the access token back to Supabase, verifies the user, and derives the public owner identity on the server. If X sign-in is unavailable, the creator uses a browser-generated management key stored in `localStorage`; the server hashes that key into a stable private owner identity and applies the same creation rate limit.

1. In the [X Developer Portal](https://developer.x.com/), create an OAuth 2.0 Web App and enable **Request email from users**.
2. Add `https://<project-ref>.supabase.co/auth/v1/callback` as the X app callback URL. For a local Supabase stack, also add `http://localhost:54321/auth/v1/callback`.
3. In **Supabase Dashboard > Authentication > Sign In / Providers**, enable **X / Twitter (OAuth 2.0)** and enter the X Client ID and Client Secret.
4. In **Authentication > URL Configuration**, set the production Site URL and allow the production `/sell` URL plus every preview URL that should support sign in. The repository's local config already allows both `http://127.0.0.1:3000/sell` and `http://localhost:3000/sell`.
5. Keep new-user signups enabled in Supabase Auth; a first X login creates the corresponding Supabase user.

The app intentionally uses the OAuth 2.0 provider name `x`, not the legacy OAuth 1.0a provider name `twitter`.

### 5. Create and configure the Vercel project

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
| `NEXT_PUBLIC_SUPABASE_URL` | The Supabase Project URL | Production, Preview, Development |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | The Supabase `sb_publishable_...` key | Production, Preview, Development |
| `NEXT_PUBLIC_SITE_URL` | `https://brand-anything.vercel.app` | Production, Preview, Development |
| `SUPABASE_DATABASE_PREFIX` | `ba_prod` | Production only |
| `SUPABASE_DATABASE_PREFIX` | `ba_dev` | Preview and Development only |

X sign-in is never inferred from the Vercel environment name. `/sell` asks `/api/auth/x-status`, which reads the X provider status from Supabase Auth. The X OAuth client ID and client secret belong only in **Supabase Dashboard > Authentication > Sign In / Providers**, never in the app's environment variables. The browser caches a successful availability result for ten minutes and checks again at the Publish step whenever that cache is missing or expired.

Optionally add a high-entropy `MODEL_UPLOAD_SIGNING_SECRET` to every environment. It signs the metadata claim that binds a model upload to its file name, size, and private Storage path. When omitted, the app derives the signature from the configured Supabase server secret. The accompanying Storage upload URL is short-lived.

Add `SUPABASE_DATABASE_PREFIX` twice with the environment scopes shown above. This keeps preview bids and test campaigns out of the production tables. The variable is optional on Vercel because the application falls back to `ba_prod` when `VERCEL_ENV=production` and `ba_dev` otherwise, but setting it explicitly makes the isolation visible in the project configuration.

Treat `SUPABASE_SECRET_KEY` as a sensitive value if the Vercel UI offers that option. Environment-variable changes only affect new deployments, so redeploy the project after adding, editing, or rotating any value. See [Vercel's environment-variable guide](https://vercel.com/docs/environment-variables/managing-environment-variables) for the current dashboard flow.

### 6. Deploy and verify

1. Select **Deploy**. Vercel should detect Next.js and run `npm run build`.
2. Open the generated URL and confirm that the homepage loads without a Supabase configuration error.
3. Open `/sell`, choose **Anything else**, upload a self-contained `.glb`, complete the wizard, publish a test campaign, and place a test bid. Environments without X OAuth credentials use browser-owned publishing without X sign-in. Use a Preview deployment for testing so records go to the `ba_dev_*` namespace.
4. In Supabase, use **Table Editor** to confirm the campaign asset record and **Storage** to confirm the model is in the matching private bucket. Open the public auction and verify that orbit, zoom, and all numbered placement controls work.
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

## Brand Anything 3D workflow

Brand Anything deliberately does not run expensive image-to-3D inference in production. The photo option is a local handoff: the browser previews the reference and generates a complete prompt, but never uploads the photo to this application. The creator installs the open-source [`img2threejs`](https://github.com/img2threejs/img2threejs) skill in the coding agent they already use:

```bash
# Codex
git clone https://github.com/img2threejs/img2threejs.git ~/.codex/skills/img2threejs

# Claude Code
git clone https://github.com/img2threejs/img2threejs.git ~/.claude/skills/img2threejs
```

The generated prompt asks the agent to reconstruct and browser-verify the object using the skill's quality gates, keep its procedural Three.js source and evidence, and export a self-contained `brand-anything.glb`. The returned GLB must contain its textures, load in a WebGL viewer, and be smaller than 25 MB. A creator who already has a model skips this handoff and uploads the GLB directly.

The browser requests a signed upload ticket, uploads the model straight to a private Supabase bucket, previews it with Three.js, and sends the signed model claim with the campaign form. The server re-verifies the claim and the stored object's size and content type before attaching it to a campaign. Public model access uses short-lived signed URLs.

## Multi-tenant campaign flow

`POST /api/auctions` validates the multipart creation form, stores optional auction media privately, and creates the campaign plus its spots in one database transaction. Brand Anything campaigns attach the already-uploaded model metadata immediately afterward using the same idempotency key. Each campaign is published at `/<slug>` and exposes only public fields; the former `/laptop/<slug>` route remains compatible.

Every environment adds four compact tables:

- `ba_<env>_laptops` stores the campaign, owner contact, deadline, pricing policy, and private photo path.
- `ba_<env>_laptop_spots` stores the ten positions and their current winning state.
- `ba_<env>_laptop_bids` is the append-only bid ledger.
- `ba_<env>_campaign_assets` records whether a campaign is a laptop or arbitrary object and, for arbitrary objects, its private GLB path and display metadata.

The owner email, bidder emails, and Storage paths are never returned by the public API. Public images use short-lived signed URLs. `anon` and `authenticated` have no direct access to the tables, buckets, or write functions.

Creation goes through `ba_<env>_create_auction(...)`. It uses advisory locks for slug and idempotency races, creates the auction and its spots atomically, and applies a small per-identity creation limit. Tenant bids go through `ba_<env>_place_auction_bid(...)`; it locks the exact campaign spot, re-checks the live minimum, appends the bid, and updates the winner in one transaction. Idempotency keys make network retries safe.

The browser only calls Next.js Route Handlers:

- `POST /api/models/upload-ticket` validates a GLB request and returns a one-use signed upload URL plus a signed metadata claim.
- `POST /api/auctions` publishes a campaign.
- `GET /api/auctions/<slug>` returns its public snapshot.
- `POST /api/auctions/<slug>/bids` places a concurrency-safe bid and optionally stores a private logo.

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
NEXT_PUBLIC_SUPABASE_URL=http://127.0.0.1:54321
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<the local PUBLISHABLE_KEY value>
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
npm run test:api-e2e
```

The platform test verifies atomic campaign creation, ten-spot isolation, RLS, equal concurrent bids, simultaneous retries, and cross-tenant idempotency-key reuse. Run it once with `SUPABASE_DATABASE_PREFIX=ba_dev` and once with `ba_prod` when validating both namespaces.

The API E2E test builds and starts the production Next.js server on a free local port. It verifies the generic auction RPC surface, removed laptop routes, coded error responses, and the complete publish/read/bid flow for a non-laptop object. It creates uniquely named test auctions, so run `supabase db reset` first and use a local Supabase project unless you deliberately set `ALLOW_REMOTE_API_E2E=1`.

## Follow and support

Follow [@biIIIionaire on X](https://x.com/biIIIionaire) for project updates and new experiments.

If Brand Anything helped you launch something of your own, you can support its continued development with a tip through [X Payment](https://x.com/i/money/pay/biIIIionaire).

You can also support the project through [Buy Me a Coffee](https://www.buymeacoffee.com/tempes666).

<a href="https://www.buymeacoffee.com/tempes666" target="_blank" rel="noreferrer"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" alt="Buy Me A Coffee"></a>
