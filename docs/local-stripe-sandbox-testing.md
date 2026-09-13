# Stripe auction testing and deployment

All bids require Stripe Checkout. The application records a bid only after
retrieving a paid Session and validating its connected account, environment,
USD currency, deposit amount, PaymentIntent, metadata and platform fee.

## Environment boundaries

| Deployment | Database/Storage prefix | Stripe key |
| --- | --- | --- |
| Local development | `ba_dev` | `sk_test_…` or permitted `rk_test_…` |
| Vercel Preview | `ba_dev` | Test mode only |
| Production | `ba_prod` | Live mode only |

Set `APP_ENV=production` on non-Vercel production hosts. Vercel supplies
`VERCEL_ENV`. A contradictory explicit `SUPABASE_DATABASE_PREFIX` fails closed.
The management/payment test suites may exercise `ba_prod` locally using
`ALLOW_LOCAL_PRODUCTION_NAMESPACE=1`; this exception requires a loopback
`SUPABASE_URL` and is rejected on Vercel. Do not set it on deployed environments.

The namespaces isolate application tables and private Storage, not Auth users
inside a shared Supabase project. For credential-level separation, deploy each
environment into its own Supabase project. The service-role credential can
access both namespaces and must never reach browser code.

Set both server `SUPABASE_URL`/`SUPABASE_SECRET_KEY` and browser
`NEXT_PUBLIC_SUPABASE_URL`/`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` to the intended
project. Browser values are compiled into the build; changing only `next start`
environment variables does not change the browser's Auth project.

## Local test setup

Install Docker, Node, Chrome, the Supabase CLI and Stripe CLI. Run:

```sh
npm ci
npx supabase start
npx supabase migration up --local
npm run test:payment-core
npm run test:management-e2e
npm run test:connect-core
npm run test:connect-e2e
npm run test:stripe-e2e
```

The first two suites discover the local Supabase URL/keys and do not call Stripe.
`test:payment-core` runs the actual service/repository/SQL with an explicitly
injected Stripe test double to exercise failures and races. It is not evidence
of real card processing. The management suite also exercises real local Auth
and browser workflows in both local namespaces.

`test:stripe-e2e` needs a Stripe **test** secret key in `.env.local` or the shell,
an installed/authenticated Stripe CLI (the script passes that same API key),
and a ready test connected account already associated with a local `ba_dev`
auction. Never attach a live account to a local fixture. The test shares that
account with an isolated temporary auction; it does not change the original
auction's account association. It builds with local browser/server credentials,
pays twice using Stripe's `4242` test card and checks:

- First payment: return-page settlement without a webhook listener.
- Second payment: local Stripe listener plus return-page confirmation.
- Winning placement, both history entries, loaded logo and distinct Bid/Outbid colors.
- First deposit refunded in Stripe and Supabase, historical logo retained.

Finally it expires open fixture Sessions, refunds remaining fixture deposits,
removes fixture logos, then deletes only the fixture auction. If cleanup cannot
finish, it preserves database records for reconciliation. Do not reset the
whole local database to clean up a failed test.

Run browser suites serially: they share the `.next` build directory.

## Creator Connect setup

From `/manage`, choose **Connect Stripe**, select the country where your business
is legally based, and continue to Stripe's hosted form. The country choices are
loaded from Stripe Country Specs; a restricted key needs read access to that
resource as well as Core Accounts/Account Links read/write access.

New merchant accounts use the **full Stripe Dashboard**, with Stripe collecting
its payment fees from the merchant and retaining the configured merchant loss
responsibility. The old combination of Express Dashboard and Stripe collection
responsibilities was rejected by Stripe. Switching to Express would require a
different financial-responsibility model, not just a UI change.
[Supported account configurations](https://docs.stripe.com/connect/accounts-v2/connected-account-configuration).

The first account-create request is saved in the database before calling Stripe.
Retries preserve its country, profile, parameters and operation key. Account
binding/status updates check current ownership inside the database transaction;
revoked recovery codes cannot bind accounts or obtain a newly generated
onboarding link. A closed account disables bidding and requires operator review
instead of silently creating a replacement.

Accounts v2 retain idempotent operations for 30 days (unlike v1 Checkout's
24-hour window). After 29 days, unbound attempts only recover a matching existing
account from Stripe inventory; they never create again automatically. Legacy
unbound auctions are checked for old open and closed accounts before creation.
Ambiguous duplicates or an inventory scan over 1,000 accounts in either state
require operator reconciliation.
[Accounts v2 idempotency](https://docs.stripe.com/api-v2-overview#idempotency).

`test:connect-core` exercises real local dev/prod SQL and simulated network races.
`test:connect-e2e` creates a local authenticated owner and auction, then uses real
Stripe sandbox account creation/hosted onboarding. It closes only its own test
account and deletes its local fixture/user afterward. The full hosted flow is a
release gate; merely reaching Stripe's form does not prove onboarding readiness.
If Stripe presents a CAPTCHA, rerun with
`STRIPE_CONNECT_INTERACTIVE=1 npm run test:connect-e2e`. Complete the sandbox
form in the open test browser; the test then verifies the dashboard return and
readiness automatically. Human verification is never bypassed or counted as a
passing automated run.

## Webhooks and return URLs

Configure a **snapshot** endpoint at `/api/stripe/webhook` with
**Connected accounts** scope and these events:

- `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.expired`
- `account.updated`
- `refund.created`, `refund.updated`, `refund.failed`

Store that endpoint's signing secret in `STRIPE_CONNECT_WEBHOOK_SECRET`.
Optional platform snapshot endpoints use `STRIPE_WEBHOOK_SECRET`. Unrelated
events and events with the wrong mode/environment are ignored. The handler
retrieves current account capabilities rather than trusting stale event flags.
Accounts v2 emit compatible v1 `account.updated` snapshots for merchant changes;
this endpoint does not accept thin-event payloads.
[Stripe event compatibility and scope](https://docs.stripe.com/connect/accounts-v2/migrate-integration#webhook-events).

Checkout/Connect redirects preserve allowlisted deployment hosts, including
Vercel's deployment/branch aliases. Non-Vercel proxies must configure
`NEXT_PUBLIC_SITE_URL` as their public origin. Arbitrary `Origin` and forwarded
host headers cannot choose the redirect destination.

## Payment recovery and operations

Checkout parameters and the original connected account are saved before the
Stripe request. Retries reuse the same operation. An unbound legacy attempt or
an ambiguous attempt older than 23 hours is not recreated: Stripe may discard
an idempotency key after 24 hours, so a new create could charge again.
[Stripe idempotency retention](https://docs.stripe.com/api/idempotent_requests).

Refund obligations live in the payment table. A later outbid cannot erase an
earlier unfinished refund. `refund_pending` is not `refunded`: only a Stripe
refund with `status=succeeded` completes it. Failed/canceled/partial refunds
need operator review. Do not clear a recorded refund ID or create another
refund without checking the original PaymentIntent and all Stripe refunds.

The authenticated GET/POST `/api/internal/stripe/reconcile` endpoint checks
pending payments and refunds. Send `Authorization: Bearer <CRON_SECRET>` from
an operator tool; never expose this secret to the browser. A 503 and the returned
failed payment IDs require attention/retry. `refundsPending` requires continued
monitoring even when the response is 200: connected-account balance shortages
can leave refunds pending.
[Stripe direct-charge refunds](https://docs.stripe.com/connect/direct-charges#issue-refunds).

`vercel.json` schedules a daily production reconciliation run. Configure a
strong `CRON_SECRET` for that deployment. Vercel cron does **not** run on Preview;
use the protected endpoint manually for local/Preview recovery. Daily cron is
a fallback, not a low-latency refund SLA or a queue-draining guarantee. Review
the audit checklist before production rollout, including reconciliation time
limits, queue throughput and operator alerting.
[Vercel cron behavior](https://vercel.com/docs/cron-jobs).

Apply reviewed database migrations to each target before deploying code that
requires the new columns/RPCs. Never use a linked database reset in production.
Verify the target project and migration dry-run before `supabase db push`.
