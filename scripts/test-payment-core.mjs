import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { loadTypeScript } from "./lib/load-typescript.mjs";
import { localStack } from "./lib/local-stack.mjs";

const policy = loadTypeScript("lib/environment-policy.ts");
test("card capability alone never implies payout readiness", () => {
  const { mapStripeMerchantAccountState } = loadTypeScript("lib/stripe.ts");
  const account = { id: "acct_test", closed: false, configuration: { merchant: { capabilities: { card_payments: { status: "active" } } } } };
  assert.equal(mapStripeMerchantAccountState(account).chargesEnabled, true);
  assert.equal(mapStripeMerchantAccountState(account).payoutsEnabled, false);
  account.configuration.merchant.capabilities.stripe_balance = { payouts: { status: "restricted" } };
  assert.equal(mapStripeMerchantAccountState(account).payoutsEnabled, false);
  account.configuration.merchant.capabilities.stripe_balance.payouts.status = "active";
  assert.equal(mapStripeMerchantAccountState(account).payoutsEnabled, true);
});
test("return origins preserve deployment aliases and local browser storage without trusting arbitrary headers", () => {
  const { getRequestOrigin } = loadTypeScript("lib/request-origin.ts");
  const request = (url, host, origin = "https://attacker.example") => new Request(url, { headers: { host, origin } });
  assert.equal(getRequestOrigin(request("http://localhost:3000/api", "127.0.0.1:3000"), {}), "http://127.0.0.1:3000");
  assert.equal(getRequestOrigin(request("http://localhost:3000/api", "attacker.example"), {}), "http://localhost:3000");
  const preview = { VERCEL: "1", VERCEL_ENV: "preview", VERCEL_URL: "preview.example", VERCEL_BRANCH_URL: "branch.example", NEXT_PUBLIC_SITE_URL: "https://production.example" };
  assert.equal(getRequestOrigin(request("http://localhost:3000/api", "preview.example"), preview), "https://preview.example");
  assert.equal(getRequestOrigin(request("http://localhost:3000/api", "branch.example"), preview), "https://branch.example");
  assert.equal(getRequestOrigin(request("http://localhost:3000/api", "attacker.example"), preview), "https://preview.example");
  assert.throws(() => getRequestOrigin(request("https://attacker.example/api", "attacker.example"), {}));
});
test("deployment/database/key modes fail closed, with an explicit local-only namespace test exception", () => {
  assert.equal(policy.resolveDatabasePrefix({}), "ba_dev");
  assert.equal(policy.resolveDatabasePrefix({ VERCEL_ENV: "production" }), "ba_prod");
  assert.throws(() => policy.resolveDatabasePrefix({ VERCEL_ENV: "preview", SUPABASE_DATABASE_PREFIX: "ba_prod" }));
  assert.throws(() => policy.resolveDatabasePrefix({ VERCEL_ENV: "production", SUPABASE_DATABASE_PREFIX: "ba_dev" }));
  assert.throws(() => policy.resolveStripeMode({ STRIPE_SECRET_KEY: "sk_live_example" }));
  assert.throws(() => policy.resolveStripeMode({ VERCEL_ENV: "production", STRIPE_SECRET_KEY: "sk_test_example" }));
  assert.equal(policy.resolveStripeMode({ VERCEL_ENV: "production", STRIPE_SECRET_KEY: "rk_live_example" }), "live");
  assert.equal(policy.resolveStripeMode({ STRIPE_SECRET_KEY: "sk_test_example" }), "test");
  assert.throws(() => policy.resolveStripeMode({ STRIPE_SECRET_KEY: "not-a-key" }));
  const local = { SUPABASE_URL: "http://127.0.0.1:54321", SUPABASE_DATABASE_PREFIX: "ba_prod", ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1", STRIPE_SECRET_KEY: "sk_test_example" };
  assert.equal(policy.resolveStripeMode(local), "test");
  assert.throws(() => policy.resolveStripeMode({ ...local, VERCEL: "1", VERCEL_ENV: "preview" }));
  assert.throws(() => policy.resolveStripeMode({ ...local, SUPABASE_URL: "https://example.supabase.co" }));
});

function stripeDouble() {
  const sessions = new Map();
  const keys = new Map();
  const refunds = new Map();
  const refundKeys = new Map();
  const charges = new Map(); const fees = new Map(); const feeKeys = new Map();
  const state = { sessions, refunds, charges, fees, lostCheckoutResponse: false, refundFailure: false, lostRefundResponse: false, refundPending: false,
    feeFailure: false, lostFeeResponse: false, feeUnavailable: false, autoFeeRefund: true, creates: 0, refundCreates: 0, feeRefundCreates: 0, reads: 0 };
  function settledRefund(refund) {
    if (refund.status === "succeeded") {
      const charge = charges.get(refund.charge); charge.amount_refunded = refund.amount;
      if (refund.requestedFeeRefund && state.autoFeeRefund) {
        const fee = fees.get(charge.application_fee); fee.amount_refunded = fee.amount; fee.refunded = true;
      }
    }
    return structuredClone(refund);
  }
  const api = {
    webhooks: new Stripe("sk_test_local").webhooks,
    checkout: { sessions: {
      async create(params, options) {
        const previous = keys.get(options.idempotencyKey);
        if (previous) { assert.deepEqual(params, previous.params, "Stripe retry parameters changed"); return structuredClone(previous.session); }
        const session = { id: "cs_test_" + randomUUID().replaceAll("-", ""), mode: "payment", status: "open", payment_status: "unpaid", currency: "usd",
          livemode: false, amount_total: params.line_items[0].price_data.unit_amount, metadata: params.metadata, url: "https://checkout.stripe.test/local",
          payment_intent: null };
        const entry = { params: structuredClone(params), account: options.stripeAccount, session };
        sessions.set(session.id, entry); keys.set(options.idempotencyKey, entry); state.creates++;
        if (state.lostCheckoutResponse) { state.lostCheckoutResponse = false; throw new Error("Simulated lost Checkout response"); }
        return structuredClone(session);
      },
      async retrieve(id, _params, options) {
        state.reads++;
        const entry = sessions.get(id); assert.ok(entry, "Unknown test Checkout");
        assert.equal(options.stripeAccount, entry.account, "Charge must use its reserved account");
        return structuredClone(entry.session);
      },
      async *list(_params, options) {
        for (const entry of sessions.values()) if (entry.account === options.stripeAccount) yield structuredClone(entry.session);
      },
    } },
    refunds: {
      async list(params, options) { return { data: [...refunds.values()].filter((r) => r.payment_intent === params.payment_intent && r.account === options.stripeAccount).map(settledRefund) }; },
      async retrieve(id, _params, options) { const refund = refunds.get(id); assert.equal(refund.account, options.stripeAccount); return settledRefund(refund); },
      async create(params, options) {
        assert.equal(params.refund_application_fee, true);
        if (state.refundFailure) throw new Error("Simulated Stripe outage");
        if (refundKeys.has(options.idempotencyKey)) return structuredClone(refundKeys.get(options.idempotencyKey));
        const refund = { id: "re_" + randomUUID().replaceAll("-", ""), payment_intent: params.payment_intent,
          charge: [...charges.values()].find((charge) => charge.payment_intent === params.payment_intent).id, requestedFeeRefund: true,
          amount: params.amount, currency: "usd", status: state.refundPending ? "pending" : "succeeded", metadata: params.metadata, account: options.stripeAccount };
        refunds.set(refund.id, refund); refundKeys.set(options.idempotencyKey, refund); state.refundCreates++;
        settledRefund(refund);
        if (state.lostRefundResponse) { state.lostRefundResponse = false; throw new Error("Simulated lost refund response"); }
        return structuredClone(refund);
      },
    },
    charges: { async retrieve(id, _params, options) {
      const charge = charges.get(id); assert.equal(charge.account, options.stripeAccount);
      return structuredClone({ ...charge, ...(state.feeUnavailable ? { application_fee: null } : {}) });
    } },
    applicationFees: {
      async retrieve(id, _params, options) { assert.equal(options.stripeAccount, undefined); assert.ok(fees.has(id)); return structuredClone(fees.get(id)); },
      async list(params, options) { assert.equal(options.stripeAccount, undefined); return { data: state.feeUnavailable ? [] : [...fees.values()].filter((fee) => fee.charge === params.charge).map((fee) => structuredClone(fee)), has_more: false }; },
      async createRefund(id, params, options) {
        assert.equal(options.stripeAccount, undefined); assert.equal(params.amount, undefined);
        if (state.feeFailure) throw new Error("Simulated fee refund outage");
        if (feeKeys.has(options.idempotencyKey)) return structuredClone(feeKeys.get(options.idempotencyKey));
        const fee = fees.get(id); assert.equal(fee.refunded, false);
        const refund = { id: "fr_" + randomUUID(), amount: fee.amount - fee.amount_refunded, currency: fee.currency, fee: id };
        fee.amount_refunded = fee.amount; fee.refunded = true; state.feeRefundCreates++;
        feeKeys.set(options.idempotencyKey, refund);
        if (state.lostFeeResponse) { state.lostFeeResponse = false; throw new Error("Simulated lost fee refund response"); }
        return structuredClone(refund);
      },
    },
  };
  function pay(sessionId) {
    const entry = sessions.get(sessionId);
    const session = entry.session;
    session.status = "complete"; session.payment_status = "paid"; session.url = null;
    session.payment_intent = { id: "pi_" + randomUUID().replaceAll("-", ""), status: "succeeded", currency: "usd", livemode: false,
      amount: session.amount_total, amount_received: session.amount_total, metadata: entry.params.payment_intent_data.metadata,
      application_fee_amount: entry.params.payment_intent_data.application_fee_amount };
    const chargeId = "ch_" + randomUUID(); const feeId = "fee_" + randomUUID();
    charges.set(chargeId, { id: chargeId, account: entry.account, payment_intent: session.payment_intent.id, paid: true, livemode: false,
      currency: "usd", amount: session.amount_total, amount_captured: session.amount_total, amount_refunded: 0,
      application_fee: feeId, application_fee_amount: session.payment_intent.application_fee_amount });
    fees.set(feeId, { id: feeId, account: entry.account, charge: chargeId, amount: session.payment_intent.application_fee_amount,
      amount_refunded: 0, currency: "usd", livemode: false, refunded: false });
    return session;
  }
  function manualRefund(sessionId) {
    const entry = sessions.get(sessionId); const charge = [...charges.values()].find((charge) => charge.payment_intent === entry.session.payment_intent.id);
    const refund = { id: "re_manual_" + randomUUID(), payment_intent: charge.payment_intent, charge: charge.id, requestedFeeRefund: false,
      amount: charge.amount, currency: "usd", status: "succeeded", metadata: {}, account: entry.account };
    refunds.set(refund.id, refund); state.refundCreates++; settledRefund(refund); return refund;
  }
  return { state, api, pay, manualRefund };
}

test("payment service and real local PostgreSQL preserve payment invariants", { timeout: 90_000 }, async (t) => {
  const local = localStack();
  const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
  const prefix = "ba_dev";
  const original = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: local.apiUrl, SUPABASE_DATABASE_PREFIX: prefix, VERCEL_ENV: "development", STRIPE_SECRET_KEY: "sk_test_local", STRIPE_WEBHOOK_SECRET: "whsec_local" });
  const fake = stripeDouble();
  let accountReads = 0;
  let currentAccountState = { closed: false, chargesEnabled: true, payoutsEnabled: true };
  const overrides = { "@/lib/supabase-admin": { getSupabaseAdmin: () => admin, isSupabaseConfigured: () => true },
    "@/lib/stripe": { getStripe: () => fake.api, isStripeConfigured: () => true, stripeIsLive: () => false, getStripeWebhookSecrets: () => ["whsec_local"],
      getStripeMerchantAccountState: async () => { accountReads++; return currentAccountState; } } };
  const repository = loadTypeScript("lib/stripe-bid-repository.ts", overrides);
  const service = loadTypeScript("lib/stripe-bids.ts", { ...overrides, "@/lib/stripe-bid-repository": repository });
  const webhook = loadTypeScript("app/api/stripe/webhook/route.ts", { ...overrides, "@/lib/stripe-bid-repository": repository, "@/lib/stripe-bids": service });
  const created = [];
  async function fixture(namespace = prefix) {
    const slug = "payment-core-" + randomUUID().slice(0, 8);
    const accountId = "acct_" + randomUUID().replaceAll("-", "");
    const { data, error } = await admin.from(namespace + "_laptops").insert({ slug, owner_name: "Local owner", owner_email: "test@example.test", manager_key_hash: "a".repeat(64),
      title: "Payment core test", tagline: "Local database regression", story: "This fixture verifies payment processing against a real local database.",
      laptop_model: "MacBook Pro", goal_cents: 320000, small_opening_bid_cents: 12500, medium_opening_bid_cents: 20000, large_opening_bid_cents: 40000,
      min_increment_cents: 1000, auction_closes_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: "published", idempotency_key: randomUUID(),
      stripe_account_id: accountId, stripe_charges_enabled: true, stripe_payouts_enabled: true }).select("id").single();
    assert.ifError(error); created.push({ namespace, id: data.id });
    assert.ifError((await admin.from(namespace + "_laptop_spots").insert({ laptop_id: data.id, position: 2, name: "Spot two", size: "L", dimensions: "9 × 5 cm", opening_bid_cents: 40000, min_increment_cents: 1000 })).error);
    return { slug, id: data.id, accountId, namespace };
  }
  const input = (amount = 40000) => ({ spotId: 2, amountCents: amount, brandName: "Bidder", email: "bidder@example.test", website: null, xHandle: null, logo: null, idempotencyKey: randomUUID() });
  const checkout = (f, bid) => service.createLaptopBidCheckout(f.slug, bid, null, "http://localhost:3000");
  const bids = async (f) => { const { data, error } = await admin.from(f.namespace + "_laptop_bids").select("*").eq("laptop_id", f.id); assert.ifError(error); return data; };
  const makeRefundsDue = async (f) => {
    assert.ifError((await admin.from(f.namespace + "_laptop_bid_payments").update({ reconcile_after: new Date(0).toISOString() })
      .eq("laptop_id", f.id).eq("status", "refund_pending")).error);
  };
  const deliver = (event) => {
    const payload = JSON.stringify(event);
    const signature = fake.api.webhooks.generateTestHeaderString({ payload, secret: "whsec_local" });
    return webhook.POST(new Request("http://localhost/api/stripe/webhook", { method: "POST", headers: { "stripe-signature": signature }, body: payload }));
  };
  try {
    await t.test("account webhooks ignore unrelated accounts and sync all shared auctions from current capabilities", async () => {
      const first = await fixture(); const second = await fixture();
      assert.ifError((await admin.from(prefix + "_laptops").update({ stripe_account_id: first.accountId }).eq("id", second.id)).error);
      const event = (id) => ({ id: "evt_account", object: "event", type: "account.updated", account: id, livemode: false,
        data: { object: { id, charges_enabled: false, payouts_enabled: false } } });
      assert.equal((await deliver(event("acct_unrelated"))).status, 200); assert.equal(accountReads, 0);
      assert.equal((await deliver(event(first.accountId))).status, 200); assert.equal(accountReads, 1);
      const states = () => admin.from(prefix + "_laptops").select("stripe_charges_enabled,stripe_payouts_enabled").in("id", [first.id, second.id]);
      assert.ok((await states()).data.every((row) => row.stripe_charges_enabled && row.stripe_payouts_enabled));
      currentAccountState = { closed: true, chargesEnabled: true, payoutsEnabled: true };
      assert.equal((await deliver(event(first.accountId))).status, 200);
      assert.ok((await states()).data.every((row) => !row.stripe_charges_enabled && !row.stripe_payouts_enabled));
      await assert.rejects(checkout(first, input()), /not finished/);
      currentAccountState = { closed: false, chargesEnabled: true, payoutsEnabled: true };
    });
    await t.test("stale advertised-object versions cannot create Checkout or mutate a reserved bid", async () => {
      const f = await fixture(); const assetVersion = randomUUID(); const count = fake.state.creates;
      assert.ifError((await admin.from(prefix + "_campaign_assets").insert({ laptop_id: f.id, asset_type: "laptop",
        asset_name: "MacBook Pro", model_storage_path: null, model_file_name: null, idempotency_key: assetVersion })).error);
      const bid = input();
      await assert.rejects(checkout(f, bid), (error) => error.code === "auction_asset_changed");
      await assert.rejects(checkout(f, { ...bid, assetVersion: randomUUID() }), (error) => error.code === "auction_asset_changed");
      assert.equal(fake.state.creates, count, "No Stripe Checkout may precede revision validation");
      const result = await checkout(f, { ...bid, assetVersion });
      assert.equal((await repository.getBidPaymentBySessionId(result.sessionId)).assetVersion, assetVersion);
      await assert.rejects(checkout(f, { ...bid, assetVersion: randomUUID() }), (error) => error.code === "idempotency_conflict");
      assert.equal(fake.state.creates, count + 1);
    });

    await t.test("lost Checkout response reuses exact parameters and never deletes/resubmits a conflicting logo", async () => {
      const f = await fixture(); const bid = input(); const count = fake.state.creates;
      fake.state.lostCheckoutResponse = true;
      await assert.rejects(checkout(f, bid), /lost Checkout/);
      const reserved = await repository.getBidPaymentByIdempotencyKey(bid.idempotencyKey);
      assert.ok(reserved.checkoutParameters); assert.equal(reserved.checkoutSessionId, null);
      const retry = await service.createLaptopBidCheckout(f.slug, bid, null, "https://another-preview.example");
      assert.equal(fake.state.creates, count + 1);
      assert.ok(fake.state.sessions.get(retry.sessionId).params.success_url.startsWith("http://localhost:3000/"));
      let uploaded = false;
      await assert.rejects(service.createLaptopBidCheckout(f.slug, { ...bid, brandName: "Changed" }, "different-logo", "http://localhost", async () => { uploaded = true; }), /different details/);
      assert.equal(uploaded, false);
    });

    await t.test("20 concurrent confirmations settle once; stale expiry cannot undo a paid bid", async () => {
      const f = await fixture(); const bid = input(); const session = await checkout(f, bid); fake.pay(session.sessionId);
      const results = await Promise.all(Array.from({ length: 20 }, () => service.fulfillCheckoutSession(session.sessionId, f.accountId)));
      assert.ok(results.every((r) => r.status === "accepted")); assert.equal((await bids(f)).length, 1);
      await service.expireCheckoutSession(session.sessionId, f.accountId);
      assert.equal((await repository.getBidPaymentBySessionId(session.sessionId)).status, "accepted");
      const retry = await checkout(f, bid); assert.ok(retry.checkoutUrl.includes("payment=success"));
    });

    for (const namespace of ["ba_dev", "ba_prod"]) await t.test(`${namespace}: paid concurrency, request isolation and exact maximum`, async (t) => {
      Object.assign(process.env, { SUPABASE_DATABASE_PREFIX: namespace, ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1" });
      const spot = async (f, position = 2) => {
        const result = await admin.from(namespace + "_laptop_spots").select("current_bid_cents,bid_count")
          .eq("laptop_id", f.id).eq("position", position).single();
        assert.ifError(result.error); return result.data;
      };
      try {
        await t.test("equal paid bids accept exactly one and refund the loser", async () => {
          const f = await fixture(namespace);
          const attempts = await Promise.all([checkout(f, input()), checkout(f, input())]);
          assert.equal((await bids(f)).length, 0, "Reserving Checkout is not a bid");
          attempts.forEach((attempt) => fake.pay(attempt.sessionId));
          await Promise.all(attempts.map((attempt) => service.fulfillCheckoutSession(attempt.sessionId, f.accountId)));
          await service.reconcilePendingRefunds(f.id);
          const payments = await Promise.all(attempts.map((attempt) => repository.getBidPaymentBySessionId(attempt.sessionId)));
          assert.equal(payments.filter((p) => p.status === "accepted").length, 1);
          const loser = payments.find((p) => p.status === "refunded");
          assert.ok(loser?.applicationFeeRefunded); assert.equal(loser.failureReason, "bid_too_low");
          assert.equal((await bids(f)).length, 1);
          assert.deepEqual(await spot(f), { current_bid_cents: 40000, bid_count: 1 });
        });
        await t.test("20 identical Checkout creates and confirmations produce one charge identity and ledger row", async () => {
          const f = await fixture(namespace); const bid = input(); const count = fake.state.creates;
          const attempts = await Promise.all(Array.from({ length: 20 }, () => checkout(f, bid)));
          assert.equal(new Set(attempts.map((attempt) => attempt.sessionId)).size, 1);
          assert.equal(fake.state.creates, count + 1);
          assert.equal((await bids(f)).length, 0);
          fake.pay(attempts[0].sessionId);
          const results = await Promise.all(attempts.map((attempt) => service.fulfillCheckoutSession(attempt.sessionId)));
          assert.ok(results.every((result) => result.status === "accepted"));
          assert.equal((await bids(f)).length, 1);
          assert.deepEqual(await spot(f), { current_bid_cents: 40000, bid_count: 1 });
        });
        await t.test("a key cannot reserve two positions or two auctions; independent keys remain isolated", async () => {
          for (const crossAuction of [false, true]) {
            const first = await fixture(namespace); const second = crossAuction ? await fixture(namespace) : first;
            const position = crossAuction ? 2 : 3;
            if (!crossAuction) assert.ifError((await admin.from(namespace + "_laptop_spots").insert({ laptop_id: first.id,
              position, name: "Other spot", size: "L", dimensions: "9 × 5 cm", opening_bid_cents: 40000, min_increment_cents: 1000 })).error);
            const bid = input(); const count = fake.state.creates;
            const requests = [{ f: first, bid }, { f: second, bid: { ...bid, spotId: position } }];
            const results = await Promise.allSettled(requests.map(({ f, bid }) => checkout(f, bid)));
            assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
            assert.equal(results.find((result) => result.status === "rejected").reason.code, "idempotency_conflict");
            assert.equal(fake.state.creates, count + 1);
            const winningIndex = results.findIndex((result) => result.status === "fulfilled");
            const sessionId = results[winningIndex].value.sessionId;
            const winner = requests[winningIndex]; const other = requests[1 - winningIndex];
            fake.pay(sessionId); await service.fulfillCheckoutSession(sessionId, winner.f.accountId);
            assert.deepEqual(await spot(winner.f, winner.bid.spotId), { current_bid_cents: 40000, bid_count: 1 });
            assert.deepEqual(await spot(other.f, other.bid.spotId), { current_bid_cents: null, bid_count: 0 });
            const independent = await checkout(other.f, { ...other.bid, idempotencyKey: randomUUID() });
            fake.pay(independent.sessionId); await service.fulfillCheckoutSession(independent.sessionId, other.f.accountId);
            assert.deepEqual(await spot(other.f, other.bid.spotId), { current_bid_cents: 40000, bid_count: 1 });
            assert.deepEqual(await spot(winner.f, winner.bid.spotId), { current_bid_cents: 40000, bid_count: 1 });
            for (const table of ["laptop_bid_payments", "laptop_bids"]) {
              const rows = await admin.from(namespace + "_" + table).select("id").eq("idempotency_key", bid.idempotencyKey);
              assert.ifError(rows.error); assert.equal(rows.data.length, 1, "One request key creates one reservation and one ledger row across tenants");
            }
          }
        });
        await t.test("$999999.99 is accepted, larger and fractional-cent bids cannot create Checkout", async () => {
          const f = await fixture(namespace); const count = fake.state.creates;
          const { parseBidForm } = loadTypeScript("lib/bid-validation.ts");
          for (const amount of [100000000, 100000001, 99999999.5]) {
            const bid = input(amount); const form = new FormData();
            for (const [name, value] of Object.entries(bid)) if (value !== null) form.set(name, String(value));
            assert.throws(() => parseBidForm(form));
            if (Number.isInteger(amount)) await assert.rejects(checkout(f, bid), "SQL must also reject an over-limit reservation");
          }
          assert.equal(fake.state.creates, count);
          const result = await checkout(f, input(99999999)); fake.pay(result.sessionId);
          assert.equal((await service.fulfillCheckoutSession(result.sessionId, f.accountId)).status, "accepted");
          assert.deepEqual(await spot(f), { current_bid_cents: 99999999, bid_count: 1 });
          assert.equal((await bids(f))[0].amount_cents, 99999999);
        });
      } finally { process.env.SUPABASE_DATABASE_PREFIX = prefix; }
    });

    await t.test("amount, currency, metadata, mode and account mismatches never enter the ledger", async () => {
      const f = await fixture();
      for (const mutate of [(s) => s.amount_total++, (s) => { s.currency = "eur"; }, (s) => { s.payment_intent.amount_received--; },
        (s) => { s.payment_intent.application_fee_amount = 0; }, (s) => { s.metadata.environment = "prod"; }, (s) => { s.livemode = true; }]) {
        const result = await checkout(f, input()); const session = fake.pay(result.sessionId);
        mutate(session);
        await assert.rejects(service.fulfillCheckoutSession(session.id, f.accountId));
        assert.equal((await repository.getBidPaymentBySessionId(session.id)).status, "pending");
      }
      const result = await checkout(f, input()); fake.pay(result.sessionId);
      await assert.rejects(service.fulfillCheckoutSession(result.sessionId, "acct_wrong"));
      assert.equal((await bids(f)).length, 0);
    });

    await t.test("competing paid bids settle without deadlock: only the highest remains accepted and all losers are refunded", async () => {
      const f = await fixture();
      const attempts = await Promise.all(Array.from({ length: 12 }, (_, index) => checkout(f, input(40000 + index * 1000))));
      attempts.forEach((attempt) => fake.pay(attempt.sessionId));
      await Promise.all(attempts.flatMap((attempt) => [service.fulfillCheckoutSession(attempt.sessionId), service.fulfillCheckoutSession(attempt.sessionId)]));
      await service.reconcilePendingRefunds(f.id);
      const payments = await Promise.all(attempts.map((attempt) => repository.getBidPaymentBySessionId(attempt.sessionId)));
      assert.equal(payments.filter((payment) => payment.status === "accepted").length, 1);
      assert.equal(payments.find((payment) => payment.status === "accepted").bidAmountCents, 51000);
      assert.equal(payments.filter((payment) => payment.status === "refunded").length, 11);
      const ledger = await bids(f);
      assert.equal(new Set(ledger.map((bid) => bid.idempotency_key)).size, ledger.length);
      const spot = await admin.from(prefix + "_laptop_spots").select("current_bid_cents").eq("laptop_id", f.id).single();
      assert.ifError(spot.error); assert.equal(spot.data.current_bid_cents, 51000);
    });

    await t.test("closure and distinct paid settlements share one lock order and leave no paid deposits stranded", async () => {
      const f = await fixture();
      const attempts = await Promise.all([40000, 41000, 42000].map((amount) => checkout(f, input(amount))));
      attempts.forEach((attempt) => fake.pay(attempt.sessionId));
      const close = admin.rpc(prefix + "_manage_owned_auction", {
        p_slug: f.slug, p_owner_user_id: null, p_manager_key_hashes: ["a".repeat(64)], p_action: "close", p_model: null,
      });
      const [closed] = await Promise.all([close, ...attempts.map((attempt) => service.fulfillCheckoutSession(attempt.sessionId))]);
      assert.ifError(closed.error); assert.equal(closed.data.status, "closed");
      await service.reconcilePendingRefunds(f.id);
      const payments = await Promise.all(attempts.map((attempt) => repository.getBidPaymentBySessionId(attempt.sessionId)));
      assert.ok(payments.every((payment) => ["accepted", "refunded"].includes(payment.status)));
      assert.ok(payments.filter((payment) => payment.status === "accepted").length <= 1);
      const before = (await bids(f)).length;
      await Promise.all(attempts.map((attempt) => service.fulfillCheckoutSession(attempt.sessionId)));
      assert.equal((await bids(f)).length, before, "Retries after close cannot add bids");
    });

    await t.test("local dev/prod ledgers isolate the same request key, sessions and signed webhook events", async () => {
      const development = await fixture(); const production = await fixture("ba_prod"); const bid = input();
      const devSession = await checkout(development, bid); fake.pay(devSession.sessionId);
      const devPayment = await repository.getBidPaymentByIdempotencyKey(bid.idempotencyKey);
      try {
        Object.assign(process.env, { SUPABASE_DATABASE_PREFIX: "ba_prod", ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1" });
        assert.equal(await repository.getBidPaymentByIdempotencyKey(bid.idempotencyKey), null);
        assert.equal(await repository.getBidPaymentBySessionId(devSession.sessionId), null);
        await assert.rejects(service.fulfillCheckoutSession(devSession.sessionId, development.accountId));
        const event = { id: "evt_dev_isolated", object: "event", type: "checkout.session.completed", account: development.accountId, livemode: false,
          data: { object: fake.state.sessions.get(devSession.sessionId).session } };
        assert.equal((await deliver(event)).status, 200);
        const prodSession = await checkout(production, bid); fake.pay(prodSession.sessionId);
        const prodPayment = await repository.getBidPaymentByIdempotencyKey(bid.idempotencyKey);
        assert.notEqual(prodPayment.id, devPayment.id);
        assert.equal((await service.fulfillCheckoutSession(prodSession.sessionId, production.accountId)).status, "accepted");
        assert.equal((await bids(development)).length, 0); assert.equal((await bids(production)).length, 1);
      } finally { process.env.SUPABASE_DATABASE_PREFIX = prefix; }
      assert.equal((await service.fulfillCheckoutSession(devSession.sessionId, development.accountId)).status, "accepted");
      assert.equal((await bids(development)).length, 1); assert.equal((await bids(production)).length, 1);
    });

    await t.test("webhook recovers an unattached session; unrelated and cross-environment events are ignored", async () => {
      const f = await fixture(); const bid = input(); fake.state.lostCheckoutResponse = true;
      await assert.rejects(checkout(f, bid));
      const payment = await repository.getBidPaymentByIdempotencyKey(bid.idempotencyKey);
      const entry = [...fake.state.sessions.values()].find((e) => e.session.metadata.bid_payment_id === payment.id);
      const session = fake.pay(entry.session.id);
      const event = { id: "evt_local", object: "event", type: "checkout.session.completed", account: f.accountId, livemode: false, data: { object: session } };
      assert.equal((await deliver({ ...event, livemode: true })).status, 200);
      assert.equal((await deliver({ ...event, data: { object: { ...session, metadata: {} } } })).status, 200);
      assert.equal((await bids(f)).length, 0);
      assert.equal((await deliver(event)).status, 200);
      assert.equal((await repository.getBidPaymentById(payment.id)).status, "accepted");
    });

    await t.test("refund obligations survive chained outbids and a lost refund response", async () => {
      const f = await fixture(); const count = fake.state.refundCreates;
      fake.state.refundFailure = true;
      for (const amount of [40000, 41000, 42000]) {
        const result = await checkout(f, input(amount)); fake.pay(result.sessionId);
        assert.equal((await service.fulfillCheckoutSession(result.sessionId)).status, "accepted");
      }
      assert.equal((await repository.listRefundPendingPayments(f.id)).length, 2);
      fake.state.refundFailure = false; fake.state.lostRefundResponse = true;
      assert.equal((await service.reconcilePendingRefunds(f.id)).processed, 0, "Failed jobs must respect backoff");
      await makeRefundsDue(f);
      await service.reconcilePendingRefunds(f.id);
      await makeRefundsDue(f);
      await Promise.all(Array.from({ length: 5 }, () => service.reconcilePendingRefunds(f.id)));
      assert.equal((await repository.listRefundPendingPayments(f.id)).length, 0);
      assert.equal(fake.state.refundCreates, count + 2);
      assert.equal((await bids(f)).length, 3);
    });

    await t.test("a manually refunded outbid deposit remains refunded while its platform fee retries independently", async () => {
      const f = await fixture(); const first = await checkout(f, input()); fake.pay(first.sessionId); await service.fulfillCheckoutSession(first.sessionId);
      const manual = fake.manualRefund(first.sessionId);
      const refundCount = fake.state.refundCreates; const feeCount = fake.state.feeRefundCreates;
      try {
        fake.state.feeFailure = true;
        const second = await checkout(f, input(41000)); fake.pay(second.sessionId); await service.fulfillCheckoutSession(second.sessionId);
        let payment = await repository.getBidPaymentBySessionId(first.sessionId);
        assert.equal(payment.status, "refunded", "Customer refund must not be hidden behind fee recovery");
        assert.equal(payment.refundId, manual.id); assert.ok(payment.applicationFeeId);
        assert.equal(payment.applicationFeeRefunded, false);
        assert.equal(fake.state.refundCreates, refundCount, "Do not refund the customer a second time");
        fake.state.feeFailure = false; fake.state.lostFeeResponse = true;
        const result = await service.reconcilePendingRefunds(f.id, payment.id);
        assert.deepEqual(result.failed, []);
        payment = await repository.getBidPaymentById(payment.id);
        assert.equal(payment.status, "refunded"); assert.equal(payment.applicationFeeRefunded, true);
        await Promise.all(Array.from({ length: 6 }, () => service.reconcilePendingRefunds(f.id, payment.id)));
        assert.equal(fake.state.feeRefundCreates, feeCount + 1);
        assert.equal(fake.state.refundCreates, refundCount);
        assert.equal(await repository.claimPaymentWork("refund", { paymentId: payment.id }), null);
        await assert.rejects(repository.recordApplicationFee(payment.id, "fee_wrong", true));
        const regression = await admin.from(prefix + "_laptop_bid_payments").update({ application_fee_refunded: false }).eq("id", payment.id);
        assert.ok(regression.error);
      } finally { fake.state.feeFailure = false; fake.state.lostFeeResponse = false; }
    });

    await t.test("delayed application fee creation stays queued after customer refund in both environments", async () => {
      for (const namespace of ["ba_dev", "ba_prod"]) {
        const f = await fixture(namespace);
        process.env.SUPABASE_DATABASE_PREFIX = namespace; process.env.ALLOW_LOCAL_PRODUCTION_NAMESPACE = "1";
        try {
          const first = await checkout(f, input()); fake.pay(first.sessionId); await service.fulfillCheckoutSession(first.sessionId);
          fake.state.feeUnavailable = true;
          const second = await checkout(f, input(41000)); fake.pay(second.sessionId); await service.fulfillCheckoutSession(second.sessionId);
          const payment = await repository.getBidPaymentBySessionId(first.sessionId);
          assert.equal(payment.status, "refunded"); assert.equal(payment.applicationFeeRefunded, false);
          assert.equal((await service.reconcilePendingRefunds(f.id, payment.id)).pending, 1);
          fake.state.feeUnavailable = false;
          assert.equal((await service.reconcilePendingRefunds(f.id, payment.id)).processed, 1);
          assert.equal((await repository.getBidPaymentById(payment.id)).applicationFeeRefunded, true);
        } finally { fake.state.feeUnavailable = false; process.env.SUPABASE_DATABASE_PREFIX = prefix; }
      }
    });

    await t.test("fee account, mode, charge and amount mismatches cannot trigger a platform refund", async () => {
      for (const mutate of [(fee) => { fee.account = "acct_wrong"; }, (fee) => { fee.livemode = true; },
        (fee) => { fee.charge = "ch_wrong"; }, (fee) => { fee.amount = 0; }, (_fee, charge) => { charge.payment_intent = "pi_wrong"; },
        (_fee, charge) => { charge.application_fee_amount++; }]) {
        const f = await fixture(); const first = await checkout(f, input()); fake.pay(first.sessionId); await service.fulfillCheckoutSession(first.sessionId);
        const manual = fake.manualRefund(first.sessionId); const charge = fake.state.charges.get(manual.charge); const fee = fake.state.fees.get(charge.application_fee);
        mutate(fee, charge); const count = fake.state.feeRefundCreates;
        const second = await checkout(f, input(41000)); fake.pay(second.sessionId); await service.fulfillCheckoutSession(second.sessionId);
        const payment = await repository.getBidPaymentBySessionId(first.sessionId);
        assert.equal(payment.status, "refunded"); assert.equal(payment.applicationFeeRefunded, false);
        assert.equal(fake.state.feeRefundCreates, count);
      }
    });

    await t.test("partial platform-fee refunds are completed in their actual currency, not recalculated as USD", async () => {
      for (const currency of ["eur", "usd"]) {
      const f = await fixture(); const first = await checkout(f, input()); fake.pay(first.sessionId); await service.fulfillCheckoutSession(first.sessionId);
      const manual = fake.manualRefund(first.sessionId); const charge = fake.state.charges.get(manual.charge); const fee = fake.state.fees.get(charge.application_fee);
      fee.currency = currency; fee.amount = 3800; fee.amount_refunded = 1000;
      const count = fake.state.feeRefundCreates;
      const second = await checkout(f, input(41000)); fake.pay(second.sessionId); await service.fulfillCheckoutSession(second.sessionId);
      assert.equal((await repository.getBidPaymentBySessionId(first.sessionId)).applicationFeeRefunded, true);
      assert.equal(fee.amount_refunded, 3800); assert.equal(fake.state.feeRefundCreates, count + 1);
      }
    });

    await t.test("pending refunds are not reported complete and cannot regress after success", async () => {
      const f = await fixture(); const first = await checkout(f, input()); fake.pay(first.sessionId); await service.fulfillCheckoutSession(first.sessionId);
      fake.state.refundPending = true;
      const second = await checkout(f, input(41000)); fake.pay(second.sessionId); await service.fulfillCheckoutSession(second.sessionId);
      assert.equal((await service.fulfillCheckoutSession(first.sessionId)).status, "refund_pending");
      const payment = await repository.getBidPaymentBySessionId(first.sessionId);
      const refund = fake.state.refunds.get(payment.refundId); refund.status = "succeeded";
      await service.reconcilePendingRefunds(f.id, payment.id);
      await repository.recordRefund(payment.id, { ...refund, status: "pending" });
      assert.equal((await repository.getBidPaymentById(payment.id)).status, "refunded");
      fake.state.refundPending = false;
    });

    await t.test("closing before settlement queues a refund; original charge account survives seller changes", async () => {
      const f = await fixture(); const result = await checkout(f, input()); fake.pay(result.sessionId);
      assert.ifError((await admin.from(prefix + "_laptops").update({ status: "closed", stripe_account_id: "acct_replacement" }).eq("id", f.id)).error);
      assert.equal((await service.fulfillCheckoutSession(result.sessionId, f.accountId)).status, "refunded");
      assert.equal((await bids(f)).length, 0);
    });

    await t.test("orphaned sessions are recovered by reconciliation without a second Checkout", async () => {
      const f = await fixture(); const bid = input(); fake.state.lostCheckoutResponse = true;
      await assert.rejects(checkout(f, bid));
      const payment = await repository.getBidPaymentByIdempotencyKey(bid.idempotencyKey);
      const entry = [...fake.state.sessions.values()].find((value) => value.session.metadata.bid_payment_id === payment.id);
      fake.pay(entry.session.id);
      // Confine the worker test to its fixture; never reconcile unrelated local records with test doubles.
      const reconciler = loadTypeScript("lib/stripe-bids.ts", { ...overrides, "@/lib/stripe-bid-repository": {
        ...repository, claimPaymentWork: (kind, scope = {}) => repository.claimPaymentWork(kind, { ...scope, laptopId: f.id }),
      } });
      const count = fake.state.creates;
      const summary = await reconciler.reconcileStripePayments();
      assert.deepEqual(summary.failed, []);
      assert.equal(summary.backlogError, null);
      assert.ok(summary.backlog && Number.isFinite(summary.backlog.paymentDue), "reconciliation reports a readable backlog");
      assert.equal(fake.state.creates, count);
      assert.equal((await repository.getBidPaymentById(payment.id)).status, "accepted");
    });

    await t.test("a verified paid legacy-expired attempt is refunded, never silently lost or accepted", async () => {
      const f = await fixture(); const result = await checkout(f, input());
      const payment = await repository.getBidPaymentBySessionId(result.sessionId);
      assert.equal(await repository.expirePendingPayment(payment.id), true);
      fake.pay(result.sessionId);
      assert.equal((await service.fulfillCheckoutSession(result.sessionId)).status, "refunded");
      assert.equal((await bids(f)).length, 0);
    });

    await t.test("expired idempotency retention never creates another Checkout", async () => {
      const f = await fixture(); const bid = input(); fake.state.lostCheckoutResponse = true;
      await assert.rejects(checkout(f, bid));
      const now = Date.now; const count = fake.state.creates;
      try {
        const later = now() + 24 * 60 * 60 * 1000;
        Date.now = () => later;
        await assert.rejects(checkout(f, bid), /reconciliation/);
      } finally { Date.now = now; }
      assert.equal(fake.state.creates, count);
    });

    await t.test("recovery leases serialize claims, reject stale releases and reclaim expired work in both namespaces", async () => {
      for (const namespace of ["ba_dev", "ba_prod"]) {
        const f = await fixture(namespace);
        process.env.SUPABASE_DATABASE_PREFIX = namespace;
        process.env.ALLOW_LOCAL_PRODUCTION_NAMESPACE = "1";
        try {
          const session = await checkout(f, input());
          const payment = await repository.getBidPaymentBySessionId(session.sessionId);
          const scope = { laptopId: f.id, paymentId: payment.id };
          const claims = await Promise.all(Array.from({ length: 20 }, () => repository.claimPaymentWork("payment", scope)));
          const claimed = claims.filter(Boolean);
          assert.equal(claimed.length, 1);
          assert.equal(claimed[0].attempts, 1);
          const table = admin.from(namespace + "_laptop_bid_payments");
          assert.ifError((await table.update({ reconcile_lease_until: new Date(0).toISOString() }).eq("id", payment.id)).error);
          const next = await repository.claimPaymentWork("payment", scope);
          assert.notEqual(next.leaseToken, claimed[0].leaseToken);
          assert.equal(next.attempts, 2);
          await repository.finishPaymentWork(claimed[0], null);
          assert.equal(await repository.claimPaymentWork("payment", scope), null, "Old worker cannot release a new lease");
          await repository.finishPaymentWork(next, "test_outage");
          const { data, error } = await table.select("reconcile_after,reconcile_token,reconcile_last_error").eq("id", payment.id).single();
          assert.ifError(error);
          assert.equal(data.reconcile_token, null);
          assert.equal(data.reconcile_last_error, "test_outage");
          assert.ok(Date.parse(data.reconcile_after) - Date.now() > 115_000, "Second failure backs off two minutes");
          assert.equal(await repository.claimPaymentWork("payment", { laptopId: f.id }), null);
          const other = namespace === "ba_dev" ? "ba_prod" : "ba_dev";
          const cross = await admin.rpc(other + "_claim_payment_work", { p_kind: "payment", p_payment_id: payment.id });
          assert.ifError(cross.error); assert.equal(cross.data, null);
          const anonymous = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
          assert.ok((await anonymous.rpc(namespace + "_claim_payment_work", { p_kind: "payment", p_payment_id: payment.id })).error);
        } finally { process.env.SUPABASE_DATABASE_PREFIX = prefix; }
      }
    });

    await t.test("a new refund invalidates the old payment lease and becomes immediately due", async () => {
      const f = await fixture(); const session = await checkout(f, input()); fake.pay(session.sessionId);
      const payment = await repository.getBidPaymentBySessionId(session.sessionId);
      const work = await repository.claimPaymentWork("payment", { paymentId: payment.id });
      assert.ifError((await admin.from(prefix + "_laptops").update({ status: "closed" }).eq("id", f.id)).error);
      assert.equal((await service.fulfillCheckoutSession(session.sessionId, undefined, undefined, undefined, { skipRefunds: true })).status, "refund_pending");
      await repository.finishPaymentWork(work, "stale_failure");
      const refund = await repository.claimPaymentWork("refund", { laptopId: f.id });
      assert.equal(refund.id, payment.id);
      assert.equal(refund.attempts, 1);
      await repository.finishPaymentWork(refund, null, 0);
      assert.equal((await service.reconcilePendingRefunds(f.id)).processed, 1);
      assert.equal((await repository.getBidPaymentById(payment.id)).status, "refunded");
    });

    await t.test("failed jobs do not starve other due work and a one-sided queue fills the 30-job batch", async () => {
      const f = await fixture();
      // These unpaid Checkouts are real DB reservations with a local Stripe double.
      await Promise.all(Array.from({ length: 32 }, () => checkout(f, input())));
      assert.ifError((await admin.from(prefix + "_laptop_bid_payments").update({ reconcile_after: new Date(0).toISOString() }).eq("laptop_id", f.id)).error);
      const { data: oldest, error } = await admin.from(prefix + "_laptop_bid_payments").select("id,stripe_checkout_session_id")
        .eq("laptop_id", f.id).order("id").limit(1).single();
      assert.ifError(error);
      fake.state.sessions.get(oldest.stripe_checkout_session_id).session.amount_total++;
      const worker = loadTypeScript("lib/stripe-bids.ts", { ...overrides, "@/lib/stripe-bid-repository": {
        ...repository, claimPaymentWork: (kind, scope = {}) => repository.claimPaymentWork(kind, { ...scope, laptopId: f.id }),
      } });
      const result = await worker.reconcileStripePayments();
      assert.equal(result.paymentsChecked, 30); assert.equal(result.refundsChecked, 0);
      assert.equal(result.batchLimitReached, true); assert.deepEqual(result.failed, [oldest.id]);
      const remaining = await worker.reconcileStripePayments();
      assert.equal(remaining.paymentsChecked, 2); assert.equal(remaining.batchLimitReached, false);
      assert.deepEqual(remaining.failed, [], "The failed oldest payment must back off instead of blocking the next batch");
    });

    await t.test("recovery backlog is accurate, service-only and namespace-isolated", async () => {
      const other = prefix === "ba_dev" ? "ba_prod" : "ba_dev";
      const namespaceOf = (target, key) => {
        const previous = process.env.SUPABASE_DATABASE_PREFIX;
        process.env.SUPABASE_DATABASE_PREFIX = target;
        process.env.ALLOW_LOCAL_PRODUCTION_NAMESPACE = "1";
        return key().finally(() => { process.env.SUPABASE_DATABASE_PREFIX = previous; });
      };
      const before = await namespaceOf(other, () => repository.getPaymentRecoveryBacklog());
      const f = await fixture();
      await Promise.all([checkout(f, input()), checkout(f, input())]);
      const backlog = await repository.getPaymentRecoveryBacklog();
      assert.ok(backlog.paymentDue >= 2, "reserved Checkouts are due recovery work");
      assert.ok(Number.isFinite(Date.parse(backlog.oldestDueAt)), "due work reports its oldest timestamp");
      const otherAfter = await namespaceOf(other, () => repository.getPaymentRecoveryBacklog());
      assert.equal(otherAfter.paymentDue, before.paymentDue, "the other namespace must not see this backlog");
      const anonymous = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
      assert.ok((await anonymous.rpc(prefix + "_payment_recovery_backlog")).error, "browsers must not read the backlog");
    });

    await t.test("reconciliation endpoint requires its secret and reports retryable failures", async () => {
      let calls = 0;
      const route = loadTypeScript("app/api/internal/stripe/reconcile/route.ts", { ...overrides, "@/lib/stripe-bids": {
        runPaymentReconciliation: async () => { calls++; return { failed: ["payment-needs-retry"], alerts: [{ code: "recovery_failures" }] }; },
      } });
      delete process.env.CRON_SECRET;
      assert.equal((await route.GET(new Request("http://localhost/reconcile"))).status, 503);
      process.env.CRON_SECRET = "local-test-secret-not-deployed";
      assert.equal((await route.GET(new Request("http://localhost/reconcile"))).status, 401);
      assert.equal(calls, 0);
      const response = await route.POST(new Request("http://localhost/reconcile", { headers: { authorization: "Bearer local-test-secret-not-deployed" } }));
      assert.equal(response.status, 503);
      assert.equal((await response.json()).alerts[0].code, "recovery_failures");
      assert.equal(calls, 1);
    });
  } finally {
    for (const { namespace, id } of created) assert.ifError((await admin.from(namespace + "_laptops").delete().eq("id", id)).error);
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(original, key)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
