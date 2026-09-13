# Auction and payment recovery audit

Scope: restore the missing PR 11/12 behavior on the current auctions architecture,
then verify auction/payment correctness, retries, ownership and environment isolation.

## Completion requirements

- [ ] Publish → Stripe Connect → return/status refresh, through the current account auth.
- [ ] Dashboard: list owned auctions, recovery import/claim/rotate/revoke, close, reconnect.
- [ ] Closed auctions remain publicly readable with final results and disabled bidding.
- [ ] Public snapshots expose status/payment readiness and update it during polling.
- [ ] Both public views show payment confirmation, cancellation, refund and retry failures.
- [ ] Restore uploaded model draft previews; validate ownership for model repair.
- [ ] Restore responsive navigation and language control sizing.
- [ ] Restore shared connected-account migration and documented environment setup.
- [ ] Validate Stripe amount/currency/account/environment before settlement.
- [ ] Stable Checkout idempotency; logo retention on retries and ambiguous failures.
- [ ] Concurrent settlement/refund/expiry/close cannot corrupt accepted bids or double-refund.
- [ ] Ownership operations are atomic and protected from competing credentials.
- [ ] Test-mode/production namespace guards and unrelated webhook handling.
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
