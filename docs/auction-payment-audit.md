# Auction and payment recovery audit

Scope: restore the missing PR 11/12 behavior on the current auctions architecture,
then verify auction/payment correctness, retries, ownership and environment isolation.

## Completion requirements

Checked items are verified locally; they do not imply remote deployment.

- [ ] Publish → Stripe Connect → return/status refresh, through the current account auth.
- [ ] Dashboard: list owned auctions, recovery import/claim/rotate/revoke, close, reconnect.
- [x] Closed auctions remain publicly readable with final results and disabled bidding.
- [x] Public snapshots expose status/payment readiness and update it during polling.
- [x] Both public views show payment confirmation, cancellation, refund and retry failures.
- [x] Restore uploaded model draft previews; validate ownership for model repair.
- [x] Restore responsive navigation and language control sizing.
- [x] Restore shared connected-account migration and documented environment setup.
- [x] Validate Stripe amount/currency/account/environment before settlement.
- [x] Stable Checkout idempotency; logo retention on retries and ambiguous failures.
- [x] Concurrent settlement/refund/expiry/close cannot corrupt accepted bids or double-refund.
- [x] Ownership operations are atomic and protected from competing credentials.
- [x] Test-mode/production namespace guards and unrelated webhook handling.
- [ ] Meaningful local database, API and browser tests cover the above failure paths.
- [ ] Update PR 18 description, commit/push, and verify deployment/checks.

## Evidence

Starting revision: aadea5a. Existing paid-bid E2E covers two payments on a fixture
with an account injected directly into the database. It does not prove onboarding,
ownership management, closure, or environment isolation.

2026-09-13 recovery work (local; not yet pushed):

- Restored account-based management, recovery import/claim/rotation/revocation,
  Connect entry/return handling, closed public snapshots, readiness gating,
  payment notices/retry, signed model draft restoration, responsive navigation.
- Applied shared-account, serialized lifecycle, and owned-creation RPC adapter
  migrations to the local database only. Creation tests exposed and fixed the
  p_object_name/p_laptop_model and auction_id/laptop_id RPC contract mismatch.
- `npm run test:management-e2e`: 15/15 passing. Builds against local Supabase,
  exercises both local ba_dev and ba_prod namespaces, real email authentication,
  recovery operations, concurrent close, cancellation/readiness UI and signed
  model upload/preview across refresh. It intentionally makes no Stripe calls.
- `node --test scripts/test-auction-browser-state.mjs`: 3/3 passing for immutable
  publication retries, changed file contents and recovery storage migration.
- TypeScript and scoped ESLint passed. Later changes require final revalidation.

Further audit findings to resolve before completion:

- Stripe Checkout parameters must remain stable on retries, including expiry,
  connected account and return origin. Persist/validate settlement metadata.
- Cleanup must not remove logos/photos referenced by accepted or ambiguous writes.
- Payment expiry/refund state transitions need compare-and-set guards; refund
  obligations must survive a later outbid before an earlier refund completes.
- Enforce production/test namespace and Stripe mode boundaries; ignore unrelated
  webhook events without allowing cross-environment settlement.
- Verify Connect capabilities, onboarding, stale credentials and account updates.
- Review ownership SQL's nullable boolean comparisons and publication's split
  create/layout/asset writes, including idempotent retry after partial failure.
- The Mac logo-cover option counts an extra spot in the UI but the published
  spotLayout currently omits it. Reconcile UI, validation and database support.
- Check minimum deposit rounding, maximum-bid exhausted spots and financial copy.
- Extend tests to real Connect/Checkout/refund failure paths and paid SQL races;
  replace obsolete unpaid-concurrency tests. Verify 3D closed views and responsive
  navigation in all supported languages. Update environment/deploy docs and PR.

2026-09-13 payment hardening follow-up (local; not yet pushed):

- Reserved immutable Checkout parameters/account/session/payment identity;
  ambiguous old creates fail closed rather than reuse expired Stripe keys.
- Made refund obligations durable across chained outbids, preserved accepted
  logos, and distinguished pending refunds from successful refunds.
- Added authoritative Session/PaymentIntent amount, currency, metadata, account,
  mode and fee checks; added late-paid compensation and orphan recovery.
- Enforced deployment/database/Stripe boundaries, filtered unrelated webhooks,
  fetched current account flags, and stopped assuming missing payouts are active.
- Added authenticated reconciliation entrypoint and daily production cron;
  runtime budgeting/fairness and deployed configuration remain to verify.
- Real Stripe E2E exposed Next's local request hostname normalization. Added a
  shared allowlisted external-origin resolver for Checkout and Connect.
- `npm run test:stripe-e2e`: passing against real Stripe test Checkout + local
  Supabase. Both bids, real refund success, winner/history, logo rendering and
  retention, exact return origin and distinct button colors verified. Test now
  builds with local browser credentials and cleans its own deposits/logos.
- `npm run test:payment-core`: 19/19 passing, including 20 duplicate concurrent
  confirmations, 12 distinct competing paid bids, closure races, actual dev/prod
  database isolation, outage/lost-response injection and account-status updates.
- `npm run test:management-e2e`: 15/15 passing again after payment changes.
- Full lint and typecheck passed. Management E2E includes a fresh successful build.

Remaining release gates (the resolved payment findings above do not close these):

- Atomic Connect authorization/account binding, stable account-create retries,
  actual onboarding/return flow and closed-account handling.
- Reconciliation time budget, backlog fairness and operational deployment/alerts.
- Atomic publish/layout/assets and safe photo retention after ambiguous writes.
- Model repair ownership/race tests; actual 3D rendering and responsive locale QA.
- Logo-cover spot persistence; maximum-price CTA gating; minimum bid/deposit and
  payment-copy consistency (low-price rule awaiting user choice).
- Legacy test replacement, remote migrations/configuration, PR description,
  push and deployment verification. No remote migrations have been applied here.

2026-09-13 Connect follow-up (local; not yet pushed):

- Replaced read-then-write account association with owner-checked, row-locked
  reserve/bind/status/check RPCs in both environments. A competing bind cannot
  replace the original account; revocation during Stripe calls prevents binding
  and prevents returning a newly created onboarding link.
- Added durable account-create parameters, original operation identity, legacy
  orphan lookup (open and closed accounts), and a guard outside the v2 30-day
  idempotency window. Closed Stripe accounts now persist disabled readiness.
- Real Stripe creation exposed three defects not caught by injected fixtures:
  unsupported Express + Stripe responsibilities, missing merchant country, and
  localhost being passed as the business website. Fixed with full Dashboard
  (unchanged fee/loss responsibilities), explicit persisted country selection,
  and omission of non-public website defaults in local tests.
- `npm run test:connect-core`: 29/29 passing across real local dev/prod SQL;
  `npm run test:payment-core`: 19/19 still passing. Typecheck/lint/build passed.
- `npm run test:connect-e2e` now reaches real Stripe hosted onboarding through
  local authenticated publication and the dashboard. It is NOT passing: Stripe
  presents hCaptcha after the email step (verified screenshot). Added a headed
  interactive mode for a human to finish, followed by automatic return/readiness
  assertions. Do not weaken or skip that release gate to claim completion.

2026-09-13 atomic publication follow-up (local; not yet pushed):

- Replaced separate create/layout/asset writes with one owner-checked publication
  RPC in both namespaces. A layout/asset constraint failure rolls back all rows.
- Persisted the immutable publication payload. Exact retries acknowledge the
  existing result without rewriting live layout/model data or reopening a closed
  auction. Current ownership is rechecked, including after credential revocation.
  Profile name/email updates do not change the original request identity.
- Fixed nullable ownership comparisons in the historical owned-create function;
  serialized the per-owner creation-rate check for parallel publication attempts.
- Removed request-error photo deletion. A lost database response is not proof
  of rollback; both exact and conflicting retries preserve referenced photos.
  Unreferenced uploads are deliberately retained pending reference-aware cleanup;
  no production garbage collector has been deployed by this change.
- Publication fingerprints use stable user IDs rather than expiring access
  tokens. Authenticated publication never falls back to recovery-code ownership
  when its session is missing.
- Deadline bounds now run inside the transaction for new publications only;
  original committed requests remain retryable after their deadline passes.
- Applied `20260913150000_atomic_auction_publication.sql` locally only. Complete
  legacy publications receive request snapshots; incomplete legacy rows require
  explicit repair and are not silently overwritten by a new publication retry.
- `npm run test:publication-core`: 17/17 passing with real local SQL and Storage,
  including 20 concurrent exact retries, parallel rate-limit enforcement, partial
  failure rollback, credential mismatch/revocation, expired/closed retries and
  actual photo downloads after lost-response/conflict injection.
- Management E2E: 15/15 passing with a fresh local build; browser-state tests:
  4/4 passing. Full lint/typecheck and diff whitespace checks passed.
- Remaining gates above still apply: logo-cover persistence, maximum-bid CTA,
  pricing/copy decision, reconciliation operations, model/3D/locale validation,
  real hosted Connect completion, legacy tests, remote configuration and PR push.

2026-09-13 layout and bid-boundary follow-up (local; not yet pushed):

- The optional Apple logo-cover placement is now part of the published layout,
  with an explicit marker, its own 6 × 6 cm dimensions and its exact price.
  Six/ten base layouts keep their IDs and append placement 7/11 respectively.
  Public snapshots preserve the marker; live/final views place it centrally.
  No historical auction receives an invented placement: omitted old data cannot
  prove whether its owner originally enabled the option.
- Corrected six-position public geometry and translated position-name mapping.
  Creation previews preserve fractional prices, including premiums, and validate
  the actual per-placement maximum instead of publishing an over-limit premium.
- Creation prices were labelled EUR although stored as USD. Inputs and totals now
  say USD; existing stored monetary amounts are unchanged.
- Centralized per-spot upper-bound eligibility across lid buttons, table actions,
  3D markers, selectors and bid forms. Reaching the cap does not close other spots.
  Closed 3D auctions disable selection and remove the payment form.
- Display currency bounds use cents rather than whole units and round back within
  USD constraints. An unrepresentable narrow range offers a switch to USD instead
  of an invalid form. Fixed binary floating-point half-cent conversion ties.
- `node --test scripts/test-auction-layout-rules.mjs`: 3/3 passing.
- `npm run test:layout-e2e`: 4/4 passing. Real local auth and browser publication of
  both layouts, persisted exact prices, non-overlap at desktop/390px, three-locale
  overflow/limit-copy checks, maximum-price form validity and actual rendered
  Cybertruck model with exhausted/closed controls. UI readiness is a fixture;
  this suite deliberately makes no Stripe payment-network calls.
- `npm run test:stripe-e2e`: passed again with real test-mode payments/refund,
  return-page settlement, winner/history, logo rendering and Bid/Outbid colors.
- Publication core 17/17 and payment core 19/19 passed again. Lint, typecheck and
  production builds passed; inspected six/ten lid and real 3D screenshots.
- Still open: low-price/deposit business rule (asked again), truthful remaining
  financial copy, reconciliation fairness/runtime/operations, model-repair races,
  hosted Connect human completion, legacy test replacement and remote release.

2026-09-13 recovery queue follow-up (local; not yet pushed):

- Added service-only, environment-specific claim RPCs with row locks, two-minute
  leases and compare-and-set release tokens. New refund obligations invalidate
  stale payment leases and become immediately due. Failed work backs off instead
  of continually occupying the front of the queue.
- Reconciliation alternates queues, claims at most 30 records, and shares a
  45-second network budget. Return confirmation uses 30 seconds, direct refund
  processing 20 seconds, with nested calls inheriting the enclosing budget.
- Added five-second per-request limits for Stripe and database HTTP, including
  stalled response bodies. Recovery disables SDK retries; ordinary requests keep
  their prior retry policy. Fixed lazy database thenables escaping the request
  context and Retry-After delays escaping the total deadline.
- Signed refund events target their own payment. Lease-release errors, failed
  work and exhausted budgets remain visible to the caller. Batch limits and
  deferred work are explicitly not reported as an empty queue.
- Applied `20260913160000_lease_payment_recovery_work.sql` locally only.
- Real local SQL tests cover concurrent claims, expired leases, stale workers,
  dev/prod isolation, unauthorized RPC calls, backoff, refund transitions and a
  one-sided queue with more than 30 records. Actual local HTTP tests exercise the
  Stripe/Supabase SDKs against stalled bodies and long Retry-After responses.
- `npm run test:payment-core`: 30/30 passing; full typecheck and lint passed.
- Real Stripe Bid → Outbid E2E passed again with local Supabase. Hosted Connect
  onboarding remains a separate, unpassed human-verification gate.
- Still open: deployed recovery scheduling/alerting, application-fee verification
  when adopting an externally issued refund, minimum-price and financial-copy
  decisions, model-repair races, legacy test replacement and remote release.

2026-09-13 model-repair follow-up (local; not yet pushed):

- Fixed two verified correctness defects: same-file-name replacements retained
  the old signed URL, and model repair ignored in-flight Checkout reservations.
- Added advertised asset revisions to snapshots and both bid forms. New payment
  reservations check the displayed revision while locking the auction, before
  any Stripe create call. The reserved revision is immutable. Old/stale clients
  receive an explicit refresh/review error, not a charge against a changed model.
- Model repair checks expected revision/current ownership under the same lock,
  rejects competing writes and pending/paid bids, and preserves exact retries
  after bids or closure without rewriting the asset. Old retries cannot restore
  an overwritten model. Expired payments are never assumed unpaid from age alone.
- Model rendering now separates stable resource identity from renewable download
  URLs. Same-name replacements reload; routine signature renewal does not reset
  the scene. Failed downloads can retry using the latest URL. Missing generic
  models no longer show an unrelated MacBook lid, and an already-open laptop page
  switches to its repaired generic model without a manual reload.
- Applied `20260913170000_serialize_model_repair_and_checkout.sql` locally only.
- Model core: 19/19 passing with real SQL/Storage/auth in both namespaces,
  including revoke-during-I/O and repair/reservation races. Payment core: 31/31
  passing, including rejecting stale revisions before any Stripe call.
- Management E2E: 17/17 passing with actual same-name model downloads/rendering,
  signature renewal, failed-download retry, ownership and closure. Inspected
  `/tmp/model-repair-ba_dev.png`. Layout E2E: 4/4, publication core: 17/17; real
  Stripe Bid → Outbid E2E passed again. Typecheck, lint and fresh builds passed.
- Still open: externally issued refund/application-fee verification, deployed
  recovery scheduling/alerts, minimum-price/payment-copy decision, complete
  hosted Connect onboarding, legacy test migration and remote release/PR update.

2026-09-13 application-fee recovery follow-up (local; not yet pushed):

- Fixed an owed-refund gap: a successful customer refund previously ended recovery
  even when a manually issued refund had retained the platform fee. Customer
  status now stays truthfully refunded while independent fee recovery continues.
- Persisted immutable fee identity and monotonic completion; recovery verifies
  the original charge, account, environment and full customer-deposit refund
  before touching the platform fee. It tolerates asynchronous fee creation,
  partial fee refunds, currency conversion, concurrent completion and lost
  responses without another customer refund.
- Applied `20260913180000_track_application_fee_refunds.sql` locally only.
  Existing refunded rows become due for fee verification, not assumed complete.
- Payment core: 35/35 passing, including fee outages, asynchronous visibility,
  account/mode/charge mismatches, partial fee balances and immutable DB state.
- Real Stripe E2E: 2/2 passing with local Supabase. Both normal Outbid and adoption
  of a manual customer-only refund verify full customer and application-fee
  refunds in Stripe and the database. Cleanup verifies both before deleting its
  own fixture. Typecheck, full lint and diff whitespace checks passed.
- Still open: the user decision for manual refund of a still-current winning bid
  (withdraw/reopen versus pause), minimum-price policy and truthful payment copy,
  hosted Connect human completion, legacy test migration, operational recovery
  configuration and remote migration/deployment/PR release. These tests do not
  establish a current-winner withdrawal policy or complete the overall audit.

2026-09-13 legacy test migration follow-up (local; not yet pushed):

- Removed obsolete scripts that called unpaid RPCs, modified fixed auction spots
  and allowed remote mutation. Preserved npm entrypoints as aliases to the
  current publication/payment suites, with automatic local-stack discovery.
- Migrated equal-bid races, duplicate requests, cross-position/cross-auction
  key conflicts and independent-tenant assertions to paid Checkout reservations
  and settlement. Both namespaces verify one charge identity/ledger row for
  twenty concurrent retries, a refunded equal-bid loser, exact $999999.99 limits
  and rejection of over-limit requests before Stripe creation.
- Restored explicit ten-position premium-price, slug-collision and private-table
  permission coverage. Real anonymous and authenticated clients cannot read
  private owner/bid/payment fields; unpaid RPCs are hidden even from service role.
- HTTP tests now build and run with local server/browser credentials against
  both namespaces, clean their own fixtures, and reject remote/external-server
  overrides. They verify publication/read/retry, active and removed RPC/routes,
  namespace isolation and no unpaid fallback when Stripe is unavailable.
- Payment core/concurrency: 45/45; publication core: 21/21; combined platform
  command: 58/58; API E2E: 19/19 passing. The combined command overlaps core
  coverage; these are not counts of distinct additional scenarios. Typecheck,
  full lint, fresh production build and whitespace checks passed.
- These tests use real local SQL/Auth/Storage and Stripe doubles; real card
  processing remains covered separately by the previously passing Stripe E2E.
  No remote configuration or migrations changed in this follow-up.
- Remaining gates: minimum-price and manual-current-winner-refund decisions,
  accurate financial copy, both public views' payment-notice coverage, hosted
  Connect human completion, deployed recovery scheduling/alerting, and remote
  migration/configuration, PR description, push and deployment verification.

2026-09-13 public payment-return coverage follow-up (local; not yet pushed):

- Added shared browser fault-injection checks for both laptop and actually
  rendered 3D public views, in both local namespaces. They cover every returned
  status, visible confirmation while pending, applying the returned snapshot,
  explicit rechecks after rejection/refund-pending, bounded automatic retries,
  network/server/malformed/unknown responses and expiry. Terminal states remove
  payment parameters without losing other query parameters or the URL fragment;
  unresolved states retain the original Session. Rechecks never create Checkout.
- The management suite now includes 45 passing tests. Its payment responses are
  deliberately mocked; these tests establish UI behavior, not payment-network
  success. Actual SQL/Auth/Storage/model rendering remain in use.
- Extended real Stripe E2E to a third scenario using the rendered Cybertruck's
  own form and asset version. Verified two paid bids, claimed marker/leading
  brand, history, customer and platform-fee refunds, and preserved logo download.
  This is not a logo decal-on-mesh test. Normal laptop scenarios still verify
  rendered logos and distinct Bid/Outbid colors.
- All three real Stripe scenarios reopen the original losing bidder's return
  URL and verify the refunded notice with the current winner, not stale success.
  Stripe E2E: 3/3 passing. Inspected `/tmp/stripe-3d-outbid-refunded.png` and the
  actual 3D failure/recheck UI screenshot. All financial test fixtures were
  refunded and cleaned by the scoped cleanup routine.
- This closes the two-public-views payment-notice gate; it does not complete
  hosted Connect onboarding or deployed recovery/configuration verification.
  PR 18 remains open at remote revision `aadea5a`; its successful Vercel checks
  cover that revision, not these local commits. Remaining work includes pricing
  and manual-current-winner-refund decisions, truthful financial copy, hosted
  Connect human completion and remote migration/configuration/PR release.

2026-09-14 payable-floor and recovery-alerting follow-up (local; not yet pushed):

- Closed the low-price rule without waiting on the product decision by unifying
  upward onto the floor the payment layer already enforced. `MIN_BID_AMOUNT_CENTS`
  (`$10`) is now the single source in `lib/bid-limits.ts`; `parseAuctionForm`
  refuses lower per-size opening bids and per-spot layout prices, and a new
  migration adds matching `opening_bid_cents >= 1000` constraints to both
  namespaces. Previously a creator could publish a `$1` opening price that the
  bid API always rejected as below the deposit floor. `canPlaceBid` now requires
  the payable range, so UI eligibility matches Checkout instead of only the cap.
  Choosing a different minimum is now a one-line change plus the same migration.
- Added operator alerting for payment recovery. A service-only
  `ba_<env>_payment_recovery_backlog()` RPC reports due, leased, blocked and
  outstanding work plus the oldest outstanding timestamp. `lib/payment-alerts.ts`
  turns a reconciliation report into critical failure alerts and warnings for
  backlog size, stalled work, repeatedly blocked items, unfinished batches and an
  unreadable backlog. `runPaymentReconciliation` logs every alert and POSTs the
  payload to `PAYMENT_ALERT_WEBHOOK_URL` when configured; delivery runs outside
  the recovery time budget and never throws. The protected cron endpoint returns
  the alerts with its summary.
- `npm run test:payment-core`: 53/53 passing (was 47/47), now including real
  local SQL backlog accuracy, service-only access and cross-namespace isolation.
- Publication core: 23/23 passing (was 21/21), now including a real database
  rejection of sub-floor opening prices in both namespaces.
- New `npm run test:bid-core`: 5/5 passing unit tests for the payable floor,
  exact `$10`/`$999,999.99` bounds, display-currency rounding and creation
  validation, with no network or UI dependency.
- New `npm run test:recovery-alerts`: 5/5 passing unit tests for alert
  thresholds, severity and webhook delivery/rejection/failure handling.
- Fixed a pre-existing failure in the layout browser suite: the FAQ disclosure
  locator added by `22166ae` matched on exact text, but every `summary` also
  contains a decorative `+` span, so it could never resolve. The suite now
  matches the question as part of the disclosure text. `npm run test:layout-e2e`
  is 5/5 (was 2/5 at `22166ae`).
- Re-ran the paid release gates locally: `npm run test:stripe-e2e` 3/3 (real
  test-mode Checkout, customer and platform-fee refunds), `test:api-e2e` 19/19,
  `test:management-e2e` 45/45, browser-state 4/4, model core 19/19, Connect core
  29/29, layout rules 3/3.
- Typecheck, full lint and `git diff --check` passed.

Still open and unchanged by this follow-up: hosted Connect human completion
(hCaptcha), the manual current-winner refund policy, deployed `CRON_SECRET`/
`PAYMENT_ALERT_WEBHOOK_URL` configuration, remote migration application, the
final real Stripe E2E re-run on a Preview, and PR description/head sync.

2026-09-17 product decisions and Connect simplification (local; not yet pushed):

- **Minimum bid: `$10` confirmed.** The payable floor stays at
  `MIN_BID_AMOUNT_CENTS`. No further pricing work is required.
- **Manual refunds are not supported.** This is an auction: the platform charges
  a 20% deposit, the remaining 80% is never collected automatically, and a winner
  who does not pay the balance forfeits the deposit to the auctioneer. There is
  no "paid in full, then refunded" case, so the open `withdraw/reopen` vs `pause`
  decision is closed as out of scope. Automated Outbid/rejected-settlement
  refunds are unchanged, and the defensive adoption of an out-of-band operator
  refund (customer refund plus application fee kept consistent) is retained.
- **Connect onboarding simplified to one click.** `countrySpecs` enumeration and
  the `requiresCountry` two-step protocol are gone. `POST
  /api/auctions/[slug]/stripe/connect` now creates the reserved account and
  returns Stripe's hosted onboarding link in the same request; the dashboard
  pre-fills the country (`STRIPE_CONNECT_DEFAULT_COUNTRY`, default `US`) from a
  suggestion list and Stripe's hosted form collects business, bank, capability
  and requirement details.
  - Verified against the live test API: `configuration.merchant` requires
    `identity.country` (`identity_country_required`) and an account's country is
    immutable, so one country must be sent up front. Sending only that country
    still succeeds and returns a hosted onboarding link (`acct_…` create →
    `accountLinks` → onboarding URL, then closed).
  - A bare account cannot be onboarded through a link (`configs_must_match_to_use_account_links`),
    so the country is genuinely required rather than self-imposed.
  - Stripe remains the source of truth for the country value; an unsupported code
    is surfaced as a 400 instead of silently creating an account in the wrong
    market.
- `npm run test:connect-core`: 29/29 passing against real local dev/prod SQL with
  the new single-call flow (default country, explicit country, reserved-country
  conflict). `test:connect-e2e` now asserts the pre-filled country and a single
  click before Stripe's hosted step.
- `test:management-e2e` and `test:layout-e2e` re-run after the dashboard change;
  typecheck, full lint and `git diff --check` passed.

Still open: hosted Connect completion is a human step (Stripe CAPTCHA), deployed
`CRON_SECRET`/`PAYMENT_ALERT_WEBHOOK_URL`/`STRIPE_CONNECT_DEFAULT_COUNTRY`
configuration, remote migration application, final real Stripe E2E on a Preview,
and PR description/head sync.
