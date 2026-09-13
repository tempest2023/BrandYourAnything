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
runs two isolated scenarios, each paying twice using Stripe's `4242` test card,
and checks:

- First payment: return-page settlement without a webhook listener.
- Second payment: local Stripe listener plus return-page confirmation.
- Winning placement, both history entries, loaded logo and distinct Bid/Outbid colors.
- First deposit refunded in Stripe and Supabase, historical logo retained.
- Platform fee fully refunded and its completion recorded separately. One scenario
  uses normal automatic Outbid refunds; the other first manually refunds the
  customer without the fee, then verifies Outbid adopts that refund and returns
  the fee without refunding the customer twice.

Finally it expires open fixture Sessions and verifies successful full refunds
of remaining fixture deposits and platform fees before removing fixture logos
and deleting only that fixture auction. If cleanup cannot finish, it preserves
database records for reconciliation. Do not reset the whole local database to
clean up a failed test.

Run browser suites serially: they share the `.next` build directory.

`test:concurrency` aliases `test:payment-core`; `test:laptop-platform` combines
publication and payment core suites. Their old unpaid-bid scripts were removed,
not kept as a second write path. The replacement tests cover both local
namespaces, including equal paid bids, twenty identical Checkout creates,
cross-position/cross-auction key conflicts, exact upper bounds, ten-position
premiums and actual anonymous/authenticated table permissions. They discover
local credentials automatically and have no remote-target override.

`test:api-e2e` similarly discovers the local stack, builds with matching local
browser/server credentials and runs HTTP publication, retry, removed-route,
namespace isolation and missing-Stripe checks against both namespaces. It
cleans only its own auctions. Neither this HTTP suite nor payment doubles
replace the separate real Stripe E2E requirement.

## Creator Connect setup

From `/manage`, choose **Connect Stripe** once. The dashboard posts the business
country (pre-filled from `STRIPE_CONNECT_DEFAULT_COUNTRY`, default `US`) and the
API immediately returns Stripe's hosted onboarding link. Everything else —
business details, bank account, capabilities and requirements — is collected by
Stripe's hosted onboarding, which is the rich form sellers already expect. A
restricted key needs Core Accounts/Account Links read/write access; no Country
Specs read is required.

The country is the one field Stripe will not accept later: `configuration.merchant`
requires `identity.country` at account creation (verified against the live test
API, `identity_country_required`), and an account's country cannot be changed
afterwards. That is why a single country is sent up front instead of the previous
two-step "fetch the Country Specs list, then pick" prompt. Stripe validates the
code: an unsupported country is rejected during hosted onboarding and surfaced as
a 400 rather than silently creating an account in the wrong market.

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

Customer refunds and platform-fee refunds are separate states. A payment with
`status=refunded` but `application_fee_refunded=false` stays in the recovery
queue: the customer has been refunded, but the platform fee is not yet verified
as fully returned. Recovery binds the fee to the original charge/account/mode
before refunding its remaining balance. Fee creation can be asynchronous, and
currency conversion can change its amount; do not recompute the refundable fee
from the USD bid. Restricted keys need charge read access on connected accounts
and Application Fees read/write access on the platform. Application Fee API
requests must not carry the connected-account header.
[Direct-charge fees and refunds](https://docs.stripe.com/connect/direct-charges#issue-refunds),
[fee refund API](https://docs.stripe.com/api/fee_refunds/create).

This recovery only handles refunds the auction already owes (Outbid or rejected
settlement). Manual/operator refunds are not a supported product flow: this is an
auction, the platform charges a 20% deposit, and the remaining 80% is never
collected automatically. A winner who does not pay the balance forfeits the
deposit to the auctioneer; a bidder who paid a deposit is never refunded for
having "paid in full", because the platform never charges the full amount. If an
operator still issues a refund out of band, recovery adopts it only to keep the
customer refund and the Stripe application fee consistent — it never creates a
new customer refund on its own.

The authenticated GET/POST `/api/internal/stripe/reconcile` endpoint checks
pending payments and refunds. Send `Authorization: Bearer <CRON_SECRET>` from
an operator tool; never expose this secret to the browser. A 503 and the returned
failed payment IDs require attention/retry. `refundsPending` requires continued
monitoring even when the response is 200: connected-account balance shortages
can leave refunds pending.
[Stripe direct-charge refunds](https://docs.stripe.com/connect/direct-charges#issue-refunds).

Recovery workers atomically lease one due payment at a time, alternate payment
and refund queues, and process at most 30 records per run. A run has a 45-second
network budget inside the route's 60-second limit; individual Stripe/database
requests are capped at five seconds, including response-body consumption. SDK
retries are disabled within recovery so they cannot sleep past that budget.
Unfinished leases become claimable after two minutes. Failures defer the next
attempt by 1, 2, 4, ... minutes up to one hour; pending Stripe refunds are checked
again after one minute. A newly required refund becomes immediately due even if
its payment was previously leased or deferred. Signed refund events may request
an immediate retry of their own payment, but cannot bypass an active lease.

`budgetExhausted` produces a 503. `batchLimitReached` means the worker stopped at
its batch cap, not that the queue is empty: schedule another protected run.
Successful responses can also leave deferred or actively leased work, so monitor
the age/count of pending obligations, not only HTTP status. Lease-finalization
errors are reported as failures; a crash or lost response retains the obligation
for another worker. The deployed `CRON_SECRET` and scheduler still require
deployment verification; the code does not establish a continuous refund SLA.

Every run also reads the service-only `ba_dev_payment_recovery_backlog` /
`ba_prod_payment_recovery_backlog` RPCs for due, leased, repeatedly failing and
outstanding work. `runPaymentReconciliation` turns that report into operator
alerts: failed items are critical, and due work above 50 items, work outstanding
for more than an hour, repeatedly blocked items, an unfinished batch or an
unreadable backlog are warnings. Alerts are always logged, and are POSTed as a
JSON payload to `PAYMENT_ALERT_WEBHOOK_URL` when that variable is set. Delivery
runs outside the recovery time budget, so a slow alert sink can never extend or
abort a recovery run, and a failing sink is reported rather than thrown.

## Payable opening prices

The paid Checkout path never accepts a bid below the minimum deposit floor, so
auction creation, the bid API and the database share one floor
(`MIN_BID_AMOUNT_CENTS`, currently `$10`). `parseAuctionForm` and both
`laptop_spots.opening_bid_cents` constraints refuse a lower opening price, so a
published spot can never advertise a price that Checkout would reject. Change
the floor in one place (`lib/bid-limits.ts`) and re-run the publication core
suite when the business decides on a different minimum. `test:bid-core` covers
the boundaries without touching the network.

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

## Model repairs and in-flight bids

Public snapshots include `campaign.assetVersion` when an asset exists. Both bid
forms submit that version to Checkout. The database locks the auction while
reserving a payment and rejects a missing/stale version before Stripe is called.
Already-reserved historical payments are not rewritten by this migration.

The owner-only `PUT /api/auctions/[slug]/model` API requires
`expectedAssetVersion` (the snapshot version, or explicit `null` for an auction
without an asset), plus `assetName`, `path`, `fileName`, `size` and `uploadClaim`
from a verified upload. A competing repair returns 409 instead of overwriting a
newer model. Repeating an exactly committed repair acknowledges the result;
replaying an older repair after a newer replacement cannot undo it.

Repair is forbidden while payments are pending/paid or a bid is in the ledger.
Do not manually expire a pending payment just to unlock repair: first reconcile
its authoritative Stripe state. An ambiguous creation may already have charged.
A genuinely expired unpaid Checkout can release the lock; any later verified
payment on an expired attempt is refunded rather than accepted.

`npm run test:model-core` covers real local SQL/Storage and authenticated owners
in both namespaces. The management browser suite also verifies real model
downloads/rendering, same-name replacement, stable rendering across signed-URL
renewal and recovery from a failed download. These model tests do not claim to
exercise Stripe's payment network; `test:stripe-e2e` remains the separate gate.
