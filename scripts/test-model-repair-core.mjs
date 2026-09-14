import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { localStack } from "./lib/local-stack.mjs";
import { loadTypeScript } from "./lib/load-typescript.mjs";

test("model repair and Checkout preserve one advertised object on real local SQL and Storage", { timeout: 90_000 }, async (t) => {
  const local = localStack();
  const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
  const original = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: local.apiUrl, VERCEL_ENV: "development", ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1",
    MODEL_UPLOAD_SIGNING_SECRET: "local-model-repair-test-secret" });
  const overrides = { "@/lib/supabase-admin": { getSupabaseAdmin: () => admin, isSupabaseConfigured: () => true },
    "@/lib/stripe": { isStripeConfigured: () => false } };
  const repo = loadTypeScript("lib/campaign-auction-repository.ts", overrides);
  const ownership = loadTypeScript("lib/auction-ownership.ts", overrides);
  const payments = loadTypeScript("lib/stripe-bid-repository.ts", overrides);
  const claims = loadTypeScript("lib/model-upload-claim.ts", overrides);
  const auth = loadTypeScript("lib/publishing-auth.ts", overrides);
  const route = loadTypeScript("app/api/auctions/[slug]/model/route.ts", overrides);
  const bytes = new TextEncoder().encode("o Repair\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
  try {
    for (const prefix of ["ba_dev", "ba_prod"]) await t.test(prefix, async (t) => {
      process.env.SUPABASE_DATABASE_PREFIX = prefix;
      const ids = []; const paths = []; const userIds = [];
      const bucket = prefix + "_brand_models";
      async function fixture() {
        const key = randomUUID(); const owner = auth.getManagerCredentialFromValue(key);
        const input = { slug: "model-core-" + randomUUID().slice(0, 8), ownerName: "Local owner", ownerEmail: owner.ownerEmail,
          managerKeyHash: owner.managerKeyHash, ownerUserId: null, idempotencyKey: randomUUID(), title: "Model repair regression",
          tagline: "Local model test", story: "An isolated fixture for model repair and payment races.", objectName: "MacBook Pro",
          goalCents: 320000, smallOpeningBidCents: 12500, mediumOpeningBidCents: 20000, largeOpeningBidCents: 40000,
          minIncrementCents: 1000, auctionClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), photoStoragePath: null,
          assetType: "laptop", assetName: "MacBook Pro", modelStoragePath: null, modelFileName: null,
          spotLayout: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Spot ${i + 1}`, size: "L", dimensions: "9 × 5 cm", openingBidCents: 40000 })),
        };
        const created = await repo.createAuction(input); assert.equal(created.accepted, true); ids.push(created.auctionId);
        return { id: created.auctionId, slug: input.slug, version: input.idempotencyKey, key, owner };
      }
      async function model(expectedAssetVersion) {
        const id = randomUUID(); const path = `0123456789abcdef/${id}-same-name.obj`; paths.push(path);
        assert.ifError((await admin.storage.from(bucket).upload(path, bytes, { contentType: "application/octet-stream", upsert: false })).error);
        const input = { path, fileName: "same-name.obj", size: bytes.length };
        return { ...input, assetName: "Repaired object", expectedAssetVersion,
          uploadClaim: claims.createModelUploadClaim(claims.normalizeModelClaimInput(input)),
          db: { assetName: "Repaired object", modelStoragePath: path, modelFileName: input.fileName, idempotencyKey: id, expectedAssetVersion } };
      }
      const repair = (f, m, headers = { "X-Auction-Manager-Key": f.key }, handler = route) => handler.PUT(
        new Request(`http://localhost/api/auctions/${f.slug}/model`, { method: "PUT", headers: { ...headers, "Content-Type": "application/json" }, body: JSON.stringify(m) }),
        { params: Promise.resolve({ slug: f.slug }) });
      const reserve = (f, assetVersion = f.version) => payments.createOrGetBidPayment({ laptopId: f.id, spotPosition: 1,
        bidAmountCents: 40000, depositAmountCents: 8000, bidderName: "Local bidder", bidderEmail: "bidder@example.test",
        website: null, xHandle: null, logoStoragePath: null, idempotencyKey: randomUUID(), stripeAccountId: "acct_local", assetVersion });
      const asset = async (f) => {
        const { data, error } = await admin.from(prefix + "_campaign_assets").select("*").eq("laptop_id", f.id).single();
        assert.ifError(error); return data;
      };
      try {
        await t.test("route validates ownership, signed content and expected revision before mutation", async () => {
          const f = await fixture(); const m = await model(f.version); const before = await asset(f);
          assert.equal((await repair(f, m, {})).status, 401);
          assert.equal((await repair(f, m, { "X-Auction-Manager-Key": randomUUID() })).status, 404);
          assert.equal((await repair(f, { ...m, uploadClaim: "0".repeat(64) })).status, 403);
          assert.equal((await repair(f, { ...m, size: m.size + 1 })).status, 403);
          assert.equal((await repair(f, { ...m, expectedAssetVersion: undefined })).status, 400);
          assert.equal((await repair(f, { ...m, expectedAssetVersion: randomUUID() })).status, 409);
          assert.deepEqual(await asset(f), before);
          const response = await repair(f, m); assert.equal(response.status, 200);
          const result = await response.json();
          assert.equal(result.snapshot.campaign.assetVersion, m.db.idempotencyKey);
          assert.equal(result.snapshot.campaign.modelFileName, "same-name.obj");
          const downloaded = await fetch(result.snapshot.campaign.modelUrl);
          assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
          const other = prefix === "ba_dev" ? "ba_prod" : "ba_dev";
          const cross = await admin.rpc(other + "_manage_owned_auction", { p_slug: f.slug, p_owner_user_id: null,
            p_manager_key_hashes: f.owner.managerKeyHashCandidates, p_action: "model", p_model: m.db });
          assert.ifError(cross.error); assert.equal(cross.data, null);
        });
        await t.test("real signed-in account ownership authorizes repair, not another account or invalid token", async () => {
          const accounts = [];
          for (let index = 0; index < 2; index++) {
            const email = `model-${randomUUID()}@example.test`; const password = `Local-${randomUUID()}!`;
            const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
            assert.ifError(user.error); userIds.push(user.data.user.id);
            const client = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
            const login = await client.auth.signInWithPassword({ email, password }); assert.ifError(login.error);
            const headers = { Authorization: `Bearer ${login.data.session.access_token}` };
            accounts.push({ headers, owner: await auth.getPublishingOwnerCredential(new Request("http://localhost", { headers })) });
          }
          const f = await fixture(); const m = await model(f.version);
          await ownership.claimAuctionForAccount(f.slug, f.owner, accounts[0].owner);
          assert.equal((await repair(f, m, accounts[1].headers)).status, 404);
          assert.equal((await repair(f, m, { Authorization: "Bearer invalid-test-token" })).status, 401);
          assert.equal((await asset(f)).idempotency_key, f.version);
          assert.equal((await repair(f, m, accounts[0].headers)).status, 200);
        });

        await t.test("identical retries are safe, while a stale repair cannot overwrite a later model", async () => {
          const f = await fixture(); const first = await model(f.version);
          const duplicates = await Promise.all(Array.from({ length: 12 }, () => repair(f, first)));
          assert.ok(duplicates.every((response) => response.status === 200));
          const second = await model(first.db.idempotencyKey);
          assert.equal((await repair(f, second)).status, 200);
          assert.equal((await repair(f, first)).status, 409);
          assert.equal((await asset(f)).model_storage_path, second.path);
          assert.equal((await admin.storage.from(bucket).download(first.path)).error, null, "Stale retries preserve prior model objects");
          await ownership.closeOwnedAuction(f.slug, f.owner);
          assert.equal((await repair(f, second)).status, 200, "A completed repair remains acknowledgeable after close");
          assert.equal((await repair(f, await model(second.db.idempotencyKey))).status, 409);
        });
        await t.test("competing repairs have one winner rather than last-write-wins", async () => {
          const f = await fixture(); const attempts = await Promise.all(Array.from({ length: 6 }, () => model(f.version)));
          const results = await Promise.all(attempts.map((m) => repair(f, m)));
          assert.equal(results.filter((r) => r.status === 200).length, 1);
          assert.equal(results.filter((r) => r.status === 409).length, 5);
        });
        await t.test("revocation during repair I/O is checked at the final locked write", async () => {
          const f = await fixture(); const m = await model(f.version);
          let entered; let resume;
          const enteredPromise = new Promise((resolve) => { entered = resolve; });
          const resumed = new Promise((resolve) => { resume = resolve; });
          const delayedRoute = loadTypeScript("app/api/auctions/[slug]/model/route.ts", { ...overrides,
            "@/lib/auction-ownership": { ...ownership, attachOwnedCampaignModel: async (...args) => {
              entered(); await resumed; return ownership.attachOwnedCampaignModel(...args);
            } } });
          const pending = repair(f, m, { "X-Auction-Manager-Key": f.key }, delayedRoute);
          await enteredPromise;
          assert.ifError((await admin.from(prefix + "_laptops").update({ manager_key_hash: null }).eq("id", f.id)).error);
          resume(); assert.equal((await pending).status, 404);
          assert.equal((await asset(f)).idempotency_key, f.version);
        });
        await t.test("pending Checkout locks repair; expired Checkout releases it and stale buyers are rejected", async () => {
          const f = await fixture(); const m = await model(f.version); const payment = await reserve(f);
          assert.equal((await repair(f, m)).status, 409);
          await payments.expirePendingPayment(payment.id);
          assert.equal((await repair(f, m)).status, 200);
          await assert.rejects(reserve(f), (error) => error.message === "auction_asset_changed");
          const current = await reserve(f, m.db.idempotencyKey);
          assert.equal(current.assetVersion, m.db.idempotencyKey);
          const changed = await admin.from(prefix + "_laptop_bid_payments").update({ asset_version: randomUUID() }).eq("id", current.id);
          assert.ok(changed.error);
        });
        await t.test("repair and new payment reservation cannot both win against the old revision", async () => {
          for (let i = 0; i < 8; i++) {
            const f = await fixture(); const m = await model(f.version);
            const results = await Promise.allSettled([ownership.attachOwnedCampaignModel(f.slug, f.owner, m.db), reserve(f)]);
            assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
            const rejection = results.find((r) => r.status === "rejected").reason;
            assert.match(rejection.message, /auction_asset_changed|auction_model_locked_by_payments/);
          }
        });
        await t.test("accepted paid bids permanently lock the advertised model", async () => {
          const f = await fixture(); const m = await model(f.version); const payment = await reserve(f);
          const sessionId = "cs_test_" + randomUUID(); const intentId = "pi_" + randomUUID();
          await payments.attachCheckoutSession(payment.id, sessionId);
          await payments.markBidPaymentPaid(payment.id, sessionId, intentId);
          assert.equal((await payments.settleLaptopBidPayment(payment.id)).accepted, true);
          assert.equal((await repair(f, m)).status, 409);
          assert.equal((await asset(f)).idempotency_key, f.version);
        });
      } finally {
        if (ids.length) assert.ifError((await admin.from(prefix + "_laptops").delete().in("id", ids)).error);
        if (paths.length) assert.ifError((await admin.storage.from(bucket).remove(paths)).error);
        for (const id of userIds) assert.ifError((await admin.auth.admin.deleteUser(id)).error);
      }
    });
  } finally {
    for (const key of Object.keys(process.env)) if (!Object.hasOwn(original, key)) delete process.env[key];
    Object.assign(process.env, original);
  }
});
