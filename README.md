# Brand Anything

An open-source Next.js 16 platform for auctioning brand placements on almost anything, backed by Supabase Postgres, Auth, and private Storage. A creator can upload a ready-made GLB for a car, boat, aircraft, instrument, robot, or other object and publish its interactive 3D auction at `/sell` (`/create` remains an alias). The original Mac and PC lid flow remains available.

<a href="https://www.buymeacoffee.com/tempes666" target="_blank"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" alt="Buy Me A Coffee"></a>

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/clone?repository-url=https%3A%2F%2Fgithub.com%2Ftempest2023%2FBrandYourAnything&env=SUPABASE_URL%2CSUPABASE_SECRET_KEY%2CNEXT_PUBLIC_SUPABASE_URL%2CNEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY%2CNEXT_PUBLIC_SITE_URL%2CSTRIPE_SECRET_KEY%2CSTRIPE_WEBHOOK_SECRET&envDescription=Enter%20the%20Supabase%20and%20Stripe%20server%20credentials%20plus%20the%20public%20site%20URL.%20Apply%20the%20database%20migrations%20before%20using%20the%20app.&envLink=https%3A%2F%2Fgithub.com%2Ftempest2023%2FBrandYourAnything%2Fblob%2Fmain%2FREADME.md%23production-deployment&project-name=brand-anything&repository-name=brand-anything)

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
| `STRIPE_SECRET_KEY` | Stripe test/live secret key | `sk_test_...` |
| `STRIPE_WEBHOOK_SECRET` | Stripe webhook signing secret | `whsec_...` |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Optional connected-account webhook secret | `whsec_...` |

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

When X / Twitter OAuth 2.0 is configured, `POST /api/laptops` sends the access token back to Supabase, verifies the user, and binds the auction to the immutable Supabase Auth `user.id`. If X sign-in is unavailable, the creator receives a different high-entropy recovery code for each auction. The raw code is kept only in that browser's `localStorage` (and wherever the creator backs it up); Supabase stores only its SHA-256 hash. The `/manage` page can verify and import a recovery code, manage several auctions, and atomically attach an accountless auction to an X identity. Claiming keeps the recovery code as a backup by default; the X owner can rotate it (invalidating every older code), disable it, or create a new backup for an X-only auction. Public names and email metadata are never used for authorization.

1. In the [X Developer Portal](https://developer.x.com/), create an OAuth 2.0 Web App and enable **Request email from users**.
2. Add `https://<project-ref>.supabase.co/auth/v1/callback` as the X app callback URL. For a local Supabase stack, also add `http://localhost:54321/auth/v1/callback`.
3. In **Supabase Dashboard > Authentication > Sign In / Providers**, enable **X / Twitter (OAuth 2.0)** and enter the X Client ID and Client Secret.
4. In **Authentication > URL Configuration**, set the production Site URL and allow both production `/sell` and `/manage` URLs plus every preview URL that should support sign in. The repository's local config already allows those two routes on both `http://127.0.0.1:3000` and `http://localhost:3000`.
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
| `STRIPE_SECRET_KEY` | Stripe test/live secret key | Production, Preview, Development |
| `STRIPE_WEBHOOK_SECRET` | Signing secret for `/api/stripe/webhook` | Production, Preview, Development |
| `STRIPE_CONNECT_WEBHOOK_SECRET` | Signing secret for connected-account events, when separate | Production, Preview, Development |
| `SUPABASE_DATABASE_PREFIX` | `ba_prod` | Production only |
| `SUPABASE_DATABASE_PREFIX` | `ba_dev` | Preview and Development only |

Optionally add a high-entropy `MODEL_UPLOAD_SIGNING_SECRET` to every environment. It signs the metadata claim that binds a model upload to its file name, size, and private Storage path. When omitted, the app derives the signature from the configured Supabase server secret. The accompanying Storage upload URL is short-lived.

Add `SUPABASE_DATABASE_PREFIX` twice with the environment scopes shown above. This keeps preview bids and test campaigns out of the production tables. The variable is optional on Vercel because the application falls back to `ba_prod` when `VERCEL_ENV=production` and `ba_dev` otherwise, but setting it explicitly makes the isolation visible in the project configuration.

Treat `SUPABASE_SECRET_KEY` as a sensitive value if the Vercel UI offers that option. Environment-variable changes only affect new deployments, so redeploy the project after adding, editing, or rotating any value. See [Vercel's environment-variable guide](https://vercel.com/docs/environment-variables/managing-environment-variables) for the current dashboard flow.

### Stripe Connect and local webhook setup

The platform uses Stripe Connect Accounts v2 merchants with the Express Dashboard and Stripe-hosted Checkout. Each bid deposit is a direct charge on the seller's connected account: Stripe transfers 10% of the full bid to the platform as an application fee, while the rest of the 20% deposit (less Stripe processing fees) remains with the seller. The database publishes the bid only after Stripe confirms payment; a stale bid is fully refunded, including the application fee, and the previous leader's deposit is refunded when a new paid bid takes the lead. The winning brand later pays the remaining 80% to the seller.

Enable Connect on the Stripe platform account, then add a sandbox `STRIPE_SECRET_KEY` to `.env.local`. For a restricted key, grant the platform **Accounts v2: Write** and **Core: Write**, then grant connected accounts **Checkout Sessions: Write** and **Charges and Refunds: Write**. Start the complete local stack with:

```bash
stripe login
npm run dev:sandbox
```

`dev:sandbox` refuses non-test Stripe keys and any database prefix other than `ba_dev`. It applies pending local Supabase migrations, starts Stripe CLI forwarding for platform and Connect events, keeps the ephemeral `whsec_...` value out of files and logs, injects it only into the Next.js process, and shuts both processes down together. Never commit the Stripe key. Use a Stripe test card for local bidding.

For production, create platform and connected-account event destinations at `https://brand-anything.vercel.app/api/stripe/webhook`. Subscribe the platform destination to the Checkout events and the Connect destination to `account.updated`. Store their signing secrets as `STRIPE_WEBHOOK_SECRET` and `STRIPE_CONNECT_WEBHOOK_SECRET`; when one destination handles both, the second variable can be omitted. Test and live mode have different API keys, connected accounts, webhook endpoints, and signing secrets.

### 6. Deploy and verify

1. Select **Deploy**. Vercel should detect Next.js and run `npm run build`.
2. Open the generated URL and confirm that the homepage loads without a Supabase configuration error.
3. Open `/sell`, choose **Anything else**, upload a self-contained `.glb`, complete the wizard, sign in with X, publish a test campaign, and place a test bid. Use a Preview deployment for testing so the records go to the `ba_dev_*` namespace.
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

`POST /api/laptops` validates the multipart creation form, stores an optional laptop photo privately, and creates the campaign plus all ten spots in one database transaction. Brand Anything campaigns attach the already-uploaded model metadata immediately afterward using the same idempotency key. Each campaign is published at `/<slug>` and exposes only public fields; the former `/laptop/<slug>` route remains compatible.

Every environment adds five compact tables:

- `ba_<env>_laptops` stores the campaign, owner contact, deadline, pricing policy, and private photo path.
- `ba_<env>_laptop_spots` stores the ten positions and their current winning state.
- `ba_<env>_laptop_bids` is the append-only bid ledger.
- `ba_<env>_laptop_bid_payments` keeps private Checkout, deposit, refund, and idempotency state.
- `ba_<env>_campaign_assets` records whether a campaign is a laptop or arbitrary object and, for arbitrary objects, its private GLB path and display metadata.

The owner email, bidder emails, and Storage paths are never returned by the public API. Public images use short-lived signed URLs. `anon` and `authenticated` have no direct access to the tables, buckets, or write functions.

Creation goes through `ba_<env>_create_owned_laptop(...)`. It requires exactly one credential—an X `owner_user_id` or a browser `manager_key_hash`—uses advisory locks for slug and idempotency races, and creates the laptop plus ten spots atomically. Browser-to-X claims go through `ba_<env>_claim_auction(...)`, which locks the auction row so two X identities can never win the same recovery-code claim. Paid tenant bids start in Stripe Checkout and are finalized by `ba_<env>_settle_laptop_bid_payment(...)`; it locks the exact campaign spot, re-checks the live minimum, appends the paid bid, and updates the winner in one transaction. Idempotency keys make creation, Checkout, webhook, refund, and network retries safe.

The browser only calls Next.js Route Handlers:

- `POST /api/models/upload-ticket` validates a GLB request and returns a one-use signed upload URL plus a signed metadata claim.
- `POST /api/laptops` publishes a campaign.
- `GET /api/laptops/<slug>` returns its public snapshot.
- `POST /api/laptops/<slug>/stripe/connect` starts or resumes seller payout onboarding.
- `GET/PATCH /api/laptops/<slug>/manage` verifies ownership and reads or closes an auction; `POST` atomically attaches a recovery-owned auction to X.
- `GET /api/laptops/mine` lists auctions attached to the current X user.
- `POST /api/laptops/<slug>/bids` creates a Stripe Checkout Session and optionally stores a private logo.
- `POST /api/stripe/webhook` verifies Stripe signatures and settles or refunds paid bids.

## Homepage auction

The homepage is not a separate demo ledger. It server-renders the single `ba_<env>_laptops` row marked `is_default = true`, using the same campaign, spot, bid, Stripe Checkout, and refund flow as every public auction URL. Migration `20260831023000_add_default_mac_auction.sql` creates the `brand-my-mac` campaign and its ten positions in both `ba_dev` and `ba_prod`.

The development default is attached to the sandbox Connected Account. The production record intentionally remains payment-disabled until a live Connected Account completes onboarding; database flags must never claim that test-mode or live-mode payouts are available when Stripe cannot actually deliver them.

After its deadline—or when its status is explicitly changed to `closed`—the homepage remains public as an archive of the winning brands and final bid amounts. Bid controls disappear, while the database settlement functions independently reject and refund any payment that races the close time.

`ba_dev_*` and `ba_prod_*` can safely share a Supabase project with each other and with unrelated applications. `SUPABASE_DATABASE_PREFIX` selects the environment. Production uses `ba_prod`; local development and Vercel previews use `ba_dev`.

Supabase secret keys are server-only for both flows.

## Local development

Requirements: Node.js 20+, Docker, the Supabase CLI, and the Stripe CLI.

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
NEXT_PUBLIC_SITE_URL=http://localhost:3000
NEXT_PUBLIC_X_AUTH_DEV_MOCK=1
STRIPE_SECRET_KEY=<a sandbox sk_test_ or restricted rk_test_ key>
```

`NEXT_PUBLIC_X_AUTH_DEV_MOCK=1` replaces X OAuth only while Next.js is running in development against local Supabase with the `ba_dev` prefix. Clicking **Sign in with X** creates or reuses a fixed local test identity, stores a real Supabase session in the browser, and exercises the same immutable user-ID ownership checks as a real X callback. The mock endpoint returns 404 in production builds, for hosted Supabase URLs, and for non-development database prefixes.

To test real local X OAuth instead, remove the mock variable, use `http://localhost:54321/auth/v1/callback` in the X app, uncomment the `auth.external.x` block in `supabase/config.toml`, and put `X_OAUTH_CLIENT_ID` plus `X_OAUTH_CLIENT_SECRET` in an uncommitted `.env` file. Restart the local Supabase stack after changing Auth config.

Then start Next.js together with Stripe sandbox webhook forwarding:

```bash
stripe login
npm run dev:sandbox
```

With the stack running, verify the homepage auction, connected account, Storage limits, webhook listener, and local API from a second terminal:

```bash
npm run sandbox:check
npm run test:sandbox-checkout
npm run test:sandbox-regression
```

Reset only the local homepage auction after bid testing. This keeps the default auction, its owner, connected Stripe account, and spot pricing, while expiring open Checkout Sessions, refunding refundable sandbox deposits, removing bid logos, and clearing its bid/payment history:

```bash
bun run dev:clear-default-auction --dry-run
bun run dev:clear-default-auction
```

The command refuses hosted Supabase, prefixes other than `ba_dev`, and non-test Stripe keys.

The complete manual test matrix for the homepage bid, a second auction, Stripe-hosted Checkout, outbids, refunds, and local management is in [Local Stripe sandbox testing](docs/local-stripe-sandbox-testing.md). For a fast second-auction test, the local-only helper can reuse the homepage sandbox account:

```bash
npm run sandbox:attach-account -- --slug=your-second-auction
```

The seeded `brand-my-mac` homepage row is real auction data, not a privileged demo. Bind it to its creator once per environment. With no code supplied, the command generates one and prints it exactly so you can save it in `/manage`; only the hash reaches Supabase:

```bash
npm run auction:bind-default -- --environment=dev
```

For a hosted database, first verify `.env.local` targets the intended project and set `ALLOW_REMOTE_DEFAULT_BIND=1`. Use `--environment=prod` for the production row. Supplying `DEFAULT_AUCTION_MANAGER_RECOVERY_CODE` makes a controlled rerun deterministic; changing an existing owner requires the explicit `--replace` flag.

Reset the local database and replay all migrations:

```bash
supabase db reset
```

Run the real concurrency test against local Postgres:

```bash
npm run test:concurrency
npm run test:laptop-platform
npm run test:ownership
npm run test:ownership-api
```

The platform test verifies atomic campaign creation, ten-spot isolation, RLS, equal concurrent bids, simultaneous retries, and cross-tenant idempotency-key reuse. Run it once with `SUPABASE_DATABASE_PREFIX=ba_dev` and once with `ba_prod` when validating both namespaces.

## Follow and support

Follow [@biIIIionaire on X](https://x.com/biIIIionaire) for project updates and new experiments.

If Brand Anything helped you launch something of your own, you can support its continued development with a tip through [X Payment](https://x.com/i/money/pay/biIIIionaire).

You can also support the project through [Buy Me a Coffee](https://www.buymeacoffee.com/tempes666).

<a href="https://www.buymeacoffee.com/tempes666" target="_blank" rel="noreferrer"><img src="https://www.buymeacoffee.com/assets/img/custom_images/yellow_img.png" alt="Buy Me A Coffee"></a>
