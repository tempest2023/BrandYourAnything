import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { localStack } from "./lib/local-stack.mjs";
import { loadTypeScript } from "./lib/load-typescript.mjs";

test("atomic publication against real local SQL and Storage", { timeout: 90_000 }, async (t) => {
  const local = localStack();
  const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
  const anon = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
  const original = { ...process.env };
  Object.assign(process.env, { SUPABASE_URL: local.apiUrl, VERCEL_ENV: "development", ALLOW_LOCAL_PRODUCTION_NAMESPACE: "1" });
  const overrides = { "@/lib/supabase-admin": { getSupabaseAdmin: () => admin, isSupabaseConfigured: () => true },
    "@/lib/stripe": { isStripeConfigured: () => false } };
  overrides["@/lib/auction-validation"] = loadTypeScript("lib/auction-validation.ts", overrides);
  const repository = loadTypeScript("lib/campaign-auction-repository.ts", overrides);
  const auth = loadTypeScript("lib/publishing-auth.ts", overrides);
  try {
    for (const prefix of ["ba_dev", "ba_prod"]) await t.test(prefix, async (t) => {
      process.env.SUPABASE_DATABASE_PREFIX = prefix;
      const keys = []; const photos = [];
      function fixture() {
        const owner = auth.getManagerCredentialFromValue(randomUUID());
        const idempotencyKey = randomUUID(); keys.push(idempotencyKey);
        return { slug: "publish-core-" + randomUUID().slice(0, 8), ...owner, idempotencyKey,
          title: "Atomic publication", tagline: "Local publication regression",
          story: "An isolated fixture checking atomic publication and immutable retries.", objectName: "MacBook Pro",
          goalCents: 320000, smallOpeningBidCents: 12500, mediumOpeningBidCents: 20000, largeOpeningBidCents: 40000,
          minIncrementCents: 1000, auctionClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), photoStoragePath: null,
          assetType: "laptop", assetName: "MacBook Pro", modelStoragePath: null, modelFileName: null,
          spotLayout: Array.from({ length: 6 }, (_, i) => ({ id: i + 1, name: `Spot ${i + 1}`, size: "L", dimensions: "9.5 × 5.5 cm", openingBidCents: 40000 })),
        };
      }
      // Exactly the application DTO, excluding test credential helper properties.
      function input(f) { const { kind, managerKeyHashCandidates, ...rest } = f; void kind; void managerKeyHashCandidates; return rest; }
      const publish = (f) => repository.createAuction(input(f));
      async function row(f) {
        const result = await admin.from(prefix + "_laptops").select("*").eq("idempotency_key", f.idempotencyKey).maybeSingle();
        assert.ifError(result.error); return result.data;
      }
      try {
        await t.test("layout or asset failure rolls back auction, owner and spots", async () => {
          for (const change of [{ spotLayout: [] }, { assetType: "anything", modelStoragePath: "invalid", modelFileName: "invalid.exe" }]) {
            const f = fixture();
            await assert.rejects(publish({ ...f, ...change }));
            assert.equal(await row(f), null);
            const retry = await publish(f); assert.equal(retry.reason, "created");
            const spots = await admin.from(prefix + "_laptop_spots").select("id").eq("laptop_id", retry.auctionId);
            assert.ifError(spots.error); assert.equal(spots.data.length, 6);
            const asset = await admin.from(prefix + "_campaign_assets").select("asset_type").eq("laptop_id", retry.auctionId).single();
            assert.ifError(asset.error); assert.equal(asset.data.asset_type, "laptop");
          }
        });
        await t.test("20 concurrent retries create one complete publication", async () => {
          const f = fixture(); const results = await Promise.all(Array.from({ length: 20 }, () => publish(f)));
          assert.equal(results.filter((r) => r.reason === "created").length, 1);
          assert.ok(results.every((r) => r.accepted));
          assert.equal(new Set(results.map((r) => r.auctionId)).size, 1);
          assert.equal((await row(f)).spot_layout.length, 6);
        });
        await t.test("parallel distinct publications cannot bypass the owner rate limit", async () => {
          const owner = fixture();
          const attempts = Array.from({ length: 8 }, () => ({ ...fixture(), ownerName: owner.ownerName,
            ownerEmail: owner.ownerEmail, managerKeyHash: owner.managerKeyHash }));
          const results = await Promise.all(attempts.map(publish));
          assert.equal(results.filter((r) => r.reason === "created").length, 3);
          assert.equal(results.filter((r) => r.reason === "rate_limited").length, 5);
        });
        await t.test("changed layout, photo, model, amount or date conflicts without mutation", async () => {
          const f = fixture(); await publish(f); const before = await row(f);
          for (const change of [{ spotLayout: f.spotLayout.slice(0, 5) }, { photoStoragePath: "different.png" }, { assetName: "Different model" },
            { goalCents: 320001 }, { auctionClosesAt: new Date(Date.now() + 8 * 86_400_000).toISOString() }]) {
            const result = await publish({ ...f, ...change }); assert.equal(result.reason, "idempotency_conflict"); assert.equal(result.auctionId, null);
          }
          assert.deepEqual(await row(f), before);
          assert.equal((await publish({ ...f, ownerName: "Updated profile", ownerEmail: "updated@example.test" })).reason, "already_processed");
        });
        await t.test("different credential kinds and revoked credentials cannot replay ownership", async () => {
          const f = fixture(); const result = await publish(f);
          for (const credential of [{ ownerUserId: randomUUID(), managerKeyHash: null }, { ownerUserId: null, managerKeyHash: "a".repeat(64) }]) {
            assert.equal((await publish({ ...f, ...credential })).reason, "idempotency_conflict");
          }
          assert.ifError((await admin.from(prefix + "_laptops").update({ manager_key_hash: "b".repeat(64) }).eq("id", result.auctionId)).error);
          assert.equal((await publish(f)).reason, "idempotency_conflict");
          await assert.rejects(publish({ ...fixture(), ownerUserId: null, managerKeyHash: null }));
          const { ownerUserId, managerKeyHash, ...parameters } = input(f);
          assert.ok((await anon.rpc(prefix + "_publish_owned_auction", { p_owner_user_id: ownerUserId, p_manager_key_hash: managerKeyHash, p_input: parameters })).error);
        });
        await t.test("closed auctions can acknowledge original retry without reopening or rewriting", async () => {
          const f = fixture(); const result = await publish(f);
          assert.ifError((await admin.from(prefix + "_laptops").update({ status: "closed" }).eq("id", result.auctionId)).error);
          assert.equal((await publish(f)).reason, "already_processed"); assert.equal((await row(f)).status, "closed");
        });
        await t.test("lost publication response and conflicting retry retain the real uploaded photo", async () => {
          const f = fixture(); let loseResponse = true;
          const route = loadTypeScript("app/api/auctions/route.ts", { ...overrides,
            "@/lib/publishing-auth": { ...auth, getPublishingOwnerCredential: async () => f },
            "@/lib/campaign-auction-repository": { ...repository, createAuction: async (parameters) => {
              const result = await repository.createAuction(parameters);
              if (loseResponse) { loseResponse = false; throw new Error("Injected lost publication response after commit"); }
              return result;
            } },
          });
          const request = (title = f.title) => {
            const form = new FormData();
            for (const [key, value] of Object.entries(input({ ...f, title }))) if (value !== null) form.set(key, typeof value === "object" ? JSON.stringify(value) : String(value));
            form.set("layoutCount", "6");
            form.set("photo", new File([Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64")], "photo.png", { type: "image/png" }));
            return new Request("http://localhost:3000/api/auctions", { method: "POST", body: form });
          };
          assert.equal((await route.POST(request())).status, 500);
          const saved = await row(f); assert.ok(saved?.photo_storage_path); photos.push(saved.photo_storage_path);
          assert.equal((await route.POST(request())).status, 200);
          assert.equal((await route.POST(request("Changed publication"))).status, 409);
          // Simulate an original publication whose deadline has now passed.
          f.auctionClosesAt = new Date(Math.floor(Date.now() / 1000) * 1000 - 86_400_000 + 123).toISOString();
          const originalParameters = saved.publish_parameters;
          assert.ifError((await admin.from(prefix + "_laptops").update({ status: "closed", auction_closes_at: f.auctionClosesAt,
            publish_parameters: { ...originalParameters, auctionClosesAt: f.auctionClosesAt.replace("Z", "+00:00") },
          }).eq("id", saved.id)).error);
          assert.equal((await route.POST(request())).status, 200);
          const committedKey = f.idempotencyKey;
          f.idempotencyKey = randomUUID(); keys.push(f.idempotencyKey);
          photos.push(saved.photo_storage_path.replace(committedKey, f.idempotencyKey));
          assert.equal((await route.POST(request())).status, 400, "A new request with a past deadline must still fail");
          assert.equal(await row(f), null);
          const download = await admin.storage.from(prefix + "_laptop_media").download(saved.photo_storage_path);
          assert.ifError(download.error); assert.ok(download.data.size > 0);
        });
      } finally {
        if (keys.length) assert.ifError((await admin.from(prefix + "_laptops").delete().in("idempotency_key", keys)).error);
        if (photos.length) assert.ifError((await admin.storage.from(prefix + "_laptop_media").remove(photos)).error);
      }
    });
  } finally {
    for (const name of Object.keys(process.env)) if (!(name in original)) delete process.env[name];
    Object.assign(process.env, original);
  }
});
