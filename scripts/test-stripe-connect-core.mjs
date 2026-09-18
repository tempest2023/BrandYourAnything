import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { localStack } from "./lib/local-stack.mjs";
import { loadTypeScript } from "./lib/load-typescript.mjs";

test("Connect retries and ownership use the real local database in both namespaces", { timeout: 90_000 }, async (t) => {
  const local = localStack();
  const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
  const original = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: local.apiUrl, VERCEL_ENV: "development", ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1" });
  const accounts = new Map(); const keys = new Map();
  let creates = 0; let links = 0; let lostResponse = false; let onCreate; let onLink; let onRead;
  const createdCountries = [];
  const stripe = { v2: { core: {
    accounts: {
      async create(parameters, options) {
        assert.equal(parameters.dashboard, "full");
        assert.deepEqual(parameters.defaults.responsibilities, { fees_collector: "stripe", losses_collector: "stripe" });
        createdCountries.push(parameters.identity.country);
        const existing = keys.get(options.idempotencyKey);
        if (existing) { assert.deepEqual(parameters, existing.parameters); return structuredClone(existing.account); }
        const account = { id: "acct_" + randomUUID().replaceAll("-", ""), livemode: false, metadata: parameters.metadata,
          closed: false, chargesEnabled: false, payoutsEnabled: false, detailsSubmitted: false };
        creates++; accounts.set(account.id, account); keys.set(options.idempotencyKey, { account, parameters: structuredClone(parameters) });
        await onCreate?.(account);
        if (lostResponse) { lostResponse = false; throw new Error("Simulated lost account response"); }
        return structuredClone(account);
      },
      async *list({ closed }) { for (const account of accounts.values()) if (account.closed === closed) yield structuredClone(account); },
    },
    accountLinks: { async create(parameters) { links++; await onLink?.(parameters); return { url: "https://connect.stripe.test/setup" }; } },
  } } };
  const overrides = {
    "@/lib/supabase-admin": { getSupabaseAdmin: () => admin, isSupabaseConfigured: () => true },
    "@/lib/stripe": { getStripe: () => stripe, stripeIsLive: () => false, isStripeConfigured: () => true,
      getStripeMerchantAccountState: async (id) => { await onRead?.(id); return structuredClone(accounts.get(id)); } },
  };
  const auth = loadTypeScript("lib/publishing-auth.ts", overrides);
  const repository = loadTypeScript("lib/stripe-connect-repository.ts", overrides);
  const service = loadTypeScript("lib/stripe-connect.ts", { ...overrides, "@/lib/stripe-connect-repository": repository });
  const route = loadTypeScript("app/api/auctions/[slug]/stripe/connect/route.ts", {
    ...overrides, "@/lib/stripe-connect": service, "@/lib/stripe-connect-repository": repository, "@/lib/publishing-auth": auth,
  });
  try {
    for (const prefix of ["ba_dev", "ba_prod"]) await t.test(prefix, async (t) => {
      process.env.SUPABASE_DATABASE_PREFIX = prefix;
      const created = [];
      async function fixture(legacy = false) {
        const key = randomUUID(); const owner = auth.getManagerCredentialFromValue(key);
        const slug = "connect-core-" + randomUUID().slice(0, 8);
        const { data, error } = await admin.from(prefix + "_laptops").insert({ slug, owner_name: "Connect test", owner_email: "test@example.test",
          manager_key_hash: owner.managerKeyHash, title: "Connect regression", tagline: "Local Connect test", story: "An isolated fixture for concurrent Stripe account setup.",
          laptop_model: "MacBook Pro", goal_cents: 320000, small_opening_bid_cents: 12500, medium_opening_bid_cents: 20000, large_opening_bid_cents: 40000,
          min_increment_cents: 1000, auction_closes_at: new Date(Date.now() + 7 * 86_400_000).toISOString(), status: "published", idempotency_key: randomUUID(),
          stripe_connect_legacy: legacy }).select("id").single();
        assert.ifError(error); created.push(data.id);
        return { id: data.id, slug, owner, key };
      }
      const start = (f, owner = f.owner) => service.startOwnedStripeOnboarding(f.slug, owner, "https://preview.example", "US");
      const request = (f, key = f.key) => new Request(`http://localhost:3000/api/auctions/${f.slug}/stripe/connect`, {
        method: "POST", headers: { "X-Auction-Manager-Key": key, "Content-Type": "application/json" }, body: JSON.stringify({ country: "US" }),
      });
      try {
        await t.test("one start reaches Stripe onboarding and never changes a reserved country", async () => {
          // Omitting the country uses the deployment default, and the first call
          // already returns a hosted onboarding link: no separate country step.
          const plain = await fixture(); const count = creates;
          const started = await service.startOwnedStripeOnboarding(plain.slug, plain.owner, "https://preview.example");
          assert.ok(started.onboardingUrl);
          assert.equal(createdCountries.at(-1), "US");
          assert.equal(creates, count + 1);

          // An explicit country is honored for a fresh reservation.
          const canadian = await fixture();
          await service.startOwnedStripeOnboarding(canadian.slug, canadian.owner, "https://preview.example", "CA");
          assert.equal(createdCountries.at(-1), "CA");

          // Once reserved, a different country is refused instead of silently
          // creating an account in the wrong market.
          const f = await fixture(); lostResponse = true; await assert.rejects(start(f));
          await assert.rejects(service.startOwnedStripeOnboarding(f.slug, f.owner, "https://preview.example", "CA"), (error) => error.status === 409);
          const continuation = await service.startOwnedStripeOnboarding(f.slug, f.owner, "https://preview.example");
          assert.ok(continuation.onboardingUrl);
        });

        await t.test("unauthorized and null credentials cannot read, reserve or bind accounts", async () => {
          const f = await fixture(); const count = creates;
          assert.equal((await route.POST(request(f, randomUUID()), { params: Promise.resolve({ slug: f.slug }) })).status, 404);
          for (const action of ["check", "reserve", "bind", "status"]) {
            const result = await admin.rpc(prefix + "_owned_stripe_account", {
              p_slug: f.slug, p_owner_user_id: null, p_manager_key_hashes: null, p_action: action,
              p_account_id: "acct_wrong", p_parameters: {}, p_charges_enabled: true, p_payouts_enabled: true,
            });
            assert.ifError(result.error); assert.equal(result.data, null);
          }
          assert.equal(creates, count);
          const anon = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
          assert.ok((await anon.rpc(prefix + "_owned_stripe_account", { p_slug: f.slug, p_owner_user_id: null, p_manager_key_hashes: [f.owner.managerKeyHash], p_action: "check" })).error);
        });

        await t.test("lost account responses preserve original parameters across owner profile changes", async () => {
          const f = await fixture(); const count = creates; lostResponse = true;
          await assert.rejects(start(f), /lost account/);
          const reserved = await repository.ownedStripeAccount(f.slug, f.owner, "check");
          assert.ok(reserved.parameters); assert.equal(reserved.accountId, null);
          assert.ifError((await admin.from(prefix + "_laptops").update({ title: "Renamed title" }).eq("id", f.id)).error);
          const result = await start(f, { ...f.owner, ownerEmail: "changed@example.test" });
          assert.ok(result.onboardingUrl); assert.equal(creates, count + 1);
          const current = await repository.ownedStripeAccount(f.slug, f.owner, "check");
          assert.deepEqual(current.parameters, reserved.parameters);
          assert.equal(current.requestedAt, reserved.requestedAt);
        });

        await t.test("12 simultaneous starts create one account and preserve onboarding return URLs", async () => {
          const f = await fixture(); const count = creates;
          onLink = async (params) => {
            assert.equal(params.use_case.account_onboarding.return_url, `https://preview.example/manage?stripe=return&slug=${f.slug}`);
            assert.equal(params.use_case.account_onboarding.refresh_url, `https://preview.example/manage?stripe=refresh&slug=${f.slug}`);
          };
          try { assert.ok((await Promise.all(Array.from({ length: 12 }, () => start(f)))).every((result) => result.onboardingUrl)); }
          finally { onLink = undefined; }
          assert.equal(creates, count + 1);
        });

        await t.test("revocation while Stripe creates an account prevents binding or disclosing a link", async () => {
          const f = await fixture(); const count = links;
          onCreate = async () => { assert.ifError((await admin.from(prefix + "_laptops").update({ manager_key_hash: null }).eq("id", f.id)).error); };
          try { await assert.rejects(start(f), (error) => error.status === 404); }
          finally { onCreate = undefined; }
          const row = await admin.from(prefix + "_laptops").select("stripe_account_id").eq("id", f.id).single();
          assert.ifError(row.error); assert.equal(row.data.stripe_account_id, null); assert.equal(links, count);
        });

        await t.test("revocation while Stripe creates the onboarding link prevents its disclosure", async () => {
          const f = await fixture();
          onLink = async () => { assert.ifError((await admin.from(prefix + "_laptops").update({ manager_key_hash: null }).eq("id", f.id)).error); };
          try { assert.equal((await route.POST(request(f), { params: Promise.resolve({ slug: f.slug }) })).status, 404); }
          finally { onLink = undefined; }
        });

        await t.test("concurrent bindings cannot replace each other or restore a different account's status", async () => {
          const f = await fixture();
          const results = await Promise.allSettled(["acct_one", "acct_two"].map((accountId) => repository.ownedStripeAccount(f.slug, f.owner, "bind", { accountId })));
          assert.equal(results.filter((result) => result.status === "fulfilled").length, 1);
          const bound = await repository.ownedStripeAccount(f.slug, f.owner, "check");
          await assert.rejects(repository.ownedStripeAccount(f.slug, f.owner, "status", { accountId: bound.accountId === "acct_one" ? "acct_two" : "acct_one", chargesEnabled: true, payoutsEnabled: true }), (error) => error.status === 409);
        });

        await t.test("closed Stripe accounts disable stored readiness and never silently create replacements", async () => {
          const f = await fixture(); await start(f);
          const bound = await repository.ownedStripeAccount(f.slug, f.owner, "check");
          const account = accounts.get(bound.accountId);
          Object.assign(account, { chargesEnabled: true, payoutsEnabled: true });
          assert.equal((await service.readOwnedStripeStatus(f.slug, f.owner)).ready, true);
          account.closed = true;
          const count = creates;
          await assert.rejects(start(f), (error) => error.status === 409);
          const row = await admin.from(prefix + "_laptops").select("stripe_charges_enabled,stripe_payouts_enabled").eq("id", f.id).single();
          assert.ifError(row.error); assert.equal(row.data.stripe_charges_enabled, false); assert.equal(row.data.stripe_payouts_enabled, false);
          assert.equal(creates, count);
        });

        await t.test("status read rechecks owner authorization after the Stripe response", async () => {
          const f = await fixture(); await start(f);
          onRead = async () => { assert.ifError((await admin.from(prefix + "_laptops").update({ manager_key_hash: null }).eq("id", f.id)).error); };
          try { await assert.rejects(service.readOwnedStripeStatus(f.slug, f.owner), (error) => error.status === 404); }
          finally { onRead = undefined; }
        });

        await t.test("legacy unbound account is recovered from Stripe inventory before any new create", async () => {
          const f = await fixture(true); const count = creates;
          const account = { id: "acct_" + randomUUID().replaceAll("-", ""), livemode: false, closed: false, metadata: {
            brand_anything_auction_id: f.id, brand_anything_slug: f.slug,
          }, chargesEnabled: true, payoutsEnabled: true };
          accounts.set(account.id, account);
          assert.equal((await start(f)).ready, true); assert.equal(creates, count);
          assert.equal((await repository.ownedStripeAccount(f.slug, f.owner, "check")).accountId, account.id);
        });

        await t.test("old ambiguous attempts recover rather than creating outside the v2 idempotency window", async () => {
          const f = await fixture(); lostResponse = true;
          await assert.rejects(start(f));
          const count = creates; const now = Date.now;
          try { const future = now() + 31 * 86_400_000; Date.now = () => future; assert.ok((await start(f)).onboardingUrl); }
          finally { Date.now = now; }
          assert.equal(creates, count);
        });

        await t.test("an unrecoverable old attempt never creates another account", async () => {
          const f = await fixture(); lostResponse = true; await assert.rejects(start(f));
          for (const [id, account] of accounts) if (account.metadata.brand_anything_auction_id === f.id) accounts.delete(id);
          const count = creates; const now = Date.now;
          try { const future = now() + 31 * 86_400_000; Date.now = () => future; await assert.rejects(start(f), (error) => error.status === 409); }
          finally { Date.now = now; }
          assert.equal(creates, count);
        });

        await t.test("a closed legacy orphan is recovered and disabled, never replaced", async () => {
          const f = await fixture(true); const count = creates;
          const account = { id: "acct_" + randomUUID().replaceAll("-", ""), livemode: false, closed: true,
            metadata: { brand_anything_auction_id: f.id, brand_anything_slug: f.slug }, chargesEnabled: false, payoutsEnabled: false };
          accounts.set(account.id, account);
          await assert.rejects(start(f), (error) => error.status === 409);
          assert.equal((await repository.ownedStripeAccount(f.slug, f.owner, "check")).accountId, account.id);
          assert.equal(creates, count);
        });
      } finally { for (const id of created) assert.ifError((await admin.from(prefix + "_laptops").delete().eq("id", id)).error); }
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(original, key)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
