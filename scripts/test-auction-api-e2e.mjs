import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import test from "node:test";
import { localStack, localAppEnvironment, buildLocalApp, startLocalApp } from "./lib/local-stack.mjs";

// Discover only the running local stack. Never consume a hosted .env target or
// an externally managed app: both build-time and runtime credentials must match.
const local = localStack();
const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });

async function readJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    assert.fail(`Expected JSON from ${response.url}, received: ${text.slice(0, 500)}`);
  }
}

async function assertApiError(response, expectedStatus, expectedCode) {
  assert.equal(response.status, expectedStatus);
  const body = await readJson(response);
  assert.equal(body.errorCode, expectedCode);
  assert.equal(Object.hasOwn(body, "error"), false, "API errors must be locale-independent codes");
  return body;
}

function spotLayout() {
  const definitions = [
    ["Port fuselage", "L", "Large panel · Up to 60% of the selected region", 7_998_100, [-0.1039, 0.01347, 0.17807], [0.01566, 0.34136, 0.9398]],
    ["Starboard fuselage", "L", "Large panel · Up to 60% of the selected region", 40_000_000, [-0.0843, -0.11537, -0.18705], [0.07311, -0.0414, -0.99646]],
    ["Starboard tail", "S", "Logo mark · Up to 15% of the selected region", 2_500_000, [1.12394, 0.19101, -0.04533], [0.06769, -0.02009, -0.9975]],
  ];
  return definitions.map(([name, size, dimensions, openingBidCents, position, normal], index) => ({
    id: index + 1,
    name,
    size,
    dimensions,
    openingBidCents,
    position,
    normal,
  }));
}

function auctionForm({ slug, idempotencyKey, auctionClosesAt }) {
  const form = new FormData();
  const values = {
    slug,
    title: "Your brand, aboard my private jet.",
    tagline: "Put your brand on Long-range private jet.",
    story: "Expected visibility: Domestic and international routes, Client, executive and charter flights, Media and production trips, FBO terminals and private airports, Airport aprons and hangars, Aviation shows and industry events, Business travel hubs, Posts, livestreams and videos. Each approved brand placement stays on for 6 months.",
    objectName: "Long-range private jet",
    assetType: "anything",
    assetName: "Long-range private jet",
    presetModelId: "private-jet",
    customShowcase: "",
    layoutCount: "3",
    spotLayout: JSON.stringify(spotLayout()),
    goalCents: "50498100",
    smallOpeningBidCents: "2500000",
    mediumOpeningBidCents: "20000",
    largeOpeningBidCents: "7998100",
    minIncrementCents: "1000",
    auctionClosesAt,
    idempotencyKey,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, value);
  return form;
}

async function fetchOpenApi() {
  const response = await fetch(`${local.apiUrl}/rest/v1/`, {
    headers: {
      Accept: "application/openapi+json",
      apikey: local.secretKey,
      Authorization: `Bearer ${local.secretKey}`,
    },
  });
  assert.equal(response.status, 200, "Supabase REST OpenAPI should be available");
  return readJson(response);
}

test("auction HTTP API", { timeout: 120_000 }, async (t) => {
  await buildLocalApp(localAppEnvironment(local));
  for (const databasePrefix of ["ba_dev", "ba_prod"]) await t.test(databasePrefix, async (t) => {
    const app = await startLocalApp(localAppEnvironment(local, databasePrefix));
    const genericRpcNames = [`${databasePrefix}_publish_owned_auction`, `${databasePrefix}_settle_laptop_bid_payment`];
    const legacyRpcNames = ["create_laptop", "configure_laptop_spots", "place_laptop_bid", "place_bid", "place_auction_bid"]
      .map((name) => `${databasePrefix}_${name}`);
    const managerKey = randomUUID();
    const unique = randomUUID().slice(0, 8);
    const slug = `api-e2e-${unique}`;
    const idempotencyKey = randomUUID();
    const auctionClosesAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
    const createUrl = `${app.baseUrl}/api/auctions`;
    const auctionUrl = `${createUrl}/${slug}`;

    try {
      await t.test("exposes generic database RPCs and removes legacy RPCs", async () => {
        const openApi = await fetchOpenApi();
        for (const name of genericRpcNames) {
          assert.ok(openApi.paths?.[`/rpc/${name}`], `Missing RPC /rpc/${name}; apply all Supabase migrations first.`);
        }
        for (const name of legacyRpcNames) {
          assert.equal(openApi.paths?.[`/rpc/${name}`], undefined, `Legacy RPC /rpc/${name} must not be exposed.`);
        }
      });

      await t.test("does not expose the removed laptop HTTP routes", async () => {
        const checks = [
          fetch(`${app.baseUrl}/api/laptops`, { method: "POST", body: new FormData() }),
          fetch(`${app.baseUrl}/api/laptops/${slug}`),
          fetch(`${app.baseUrl}/api/laptops/${slug}/bids`, { method: "POST", body: new FormData() }),
        ];
        for (const response of await Promise.all(checks)) {
          assert.equal(response.status, 404);
          await response.body?.cancel();
        }
      });

      await t.test("does not expose unpaid bid HTTP routes", async () => {
        const responses = await Promise.all([
          fetch(`${app.baseUrl}/api/bids`, { method: "POST", body: new FormData() }),
          fetch(`${auctionUrl}/bids`, { method: "POST", body: new FormData() }),
        ]);
        for (const response of responses) {
          assert.equal(response.status, 404);
          await response.body?.cancel();
        }
      });

      await t.test("returns stable error codes for authentication and validation", async () => {
        const unauthenticated = await fetch(createUrl, { method: "POST", body: new FormData() });
        await assertApiError(unauthenticated, 401, "authentication_required");
        assert.equal(unauthenticated.headers.get("www-authenticate"), "Bearer");

        const invalid = await fetch(createUrl, {
          method: "POST",
          headers: { "X-Auction-Manager-Key": managerKey },
          body: new FormData(),
        });
        await assertApiError(invalid, 400, "invalid_request");
      });

      await t.test("publishes and reads a non-laptop auction through HTTP", async () => {
        const response = await fetch(createUrl, {
          method: "POST",
          headers: { "X-Auction-Manager-Key": managerKey },
          body: auctionForm({ slug, idempotencyKey, auctionClosesAt }),
        });
        const body = await readJson(response);
        assert.equal(response.status, 201, `Publish failed: ${JSON.stringify(body)}\n${app.logs()}`);
        assert.deepEqual(body.result, {
          accepted: true,
          reason: "created",
          auctionId: body.result.auctionId,
          slug,
        });
        assert.match(body.result.auctionId, /^[0-9a-f-]{36}$/i);
        assert.equal(body.location, `/${slug}`);
        assert.equal(body.snapshot.campaign.assetType, "anything");
        assert.equal(body.snapshot.campaign.assetName, "Long-range private jet");
        assert.equal(body.snapshot.campaign.goal, 504_981);
        assert.equal(body.snapshot.spots.length, 3);
        assert.deepEqual(
          body.snapshot.spots.map(({ id, name, bid }) => ({ id, name, bid })),
          spotLayout().map(({ id, name, openingBidCents }) => ({ id, name, bid: openingBidCents / 100 })),
        );

        const readResponse = await fetch(auctionUrl);
        const snapshot = await readJson(readResponse);
        assert.equal(readResponse.status, 200);
        assert.equal(readResponse.headers.get("cache-control"), "no-store");
        assert.equal(snapshot.campaign.slug, slug);
        assert.deepEqual(snapshot.spots[0].surfacePosition, spotLayout()[0].position);
      });

      await t.test("keeps creation idempotent and reports slug conflicts as codes", async () => {
        const retry = await fetch(createUrl, {
          method: "POST",
          headers: { "X-Auction-Manager-Key": managerKey },
          body: auctionForm({ slug, idempotencyKey, auctionClosesAt }),
        });
        const retryBody = await readJson(retry);
        assert.equal(retry.status, 200);
        assert.equal(retryBody.result.accepted, true);
        assert.equal(retryBody.result.reason, "already_processed");

        const collision = await fetch(createUrl, {
          method: "POST",
          headers: { "X-Auction-Manager-Key": managerKey },
          body: auctionForm({ slug, idempotencyKey: randomUUID(), auctionClosesAt }),
        });
        const collisionBody = await assertApiError(collision, 409, "slug_taken");
        assert.equal(collisionBody.result.reason, "slug_taken");
      });

      await t.test("publication remains in its namespace and missing Stripe never falls back to an unpaid bid", async () => {
        const own = await admin.from(databasePrefix + "_laptops").select("id").eq("slug", slug).single();
        assert.ifError(own.error);
        const otherPrefix = databasePrefix === "ba_dev" ? "ba_prod" : "ba_dev";
        const other = await admin.from(otherPrefix + "_laptops").select("id").eq("slug", slug);
        assert.ifError(other.error); assert.equal(other.data.length, 0);
        const form = new FormData();
        for (const [key, value] of Object.entries({ spotId: "1", amountCents: "7998100", brandName: "Not yet paid",
          email: "unpaid@example.test", idempotencyKey: randomUUID() })) form.set(key, value);
        const response = await fetch(`${auctionUrl}/bids/checkout`, { method: "POST", body: form });
        assert.equal(response.status, 503); await response.body?.cancel();
        for (const table of ["laptop_bids", "laptop_bid_payments"]) {
          const result = await admin.from(databasePrefix + "_" + table).select("id").eq("laptop_id", own.data.id);
          assert.ifError(result.error); assert.equal(result.data.length, 0);
        }
      });

      await t.test("returns a coded 404 for an unknown auction", async () => {
        const response = await fetch(`${createUrl}/missing-${randomUUID().slice(0, 8)}`);
        await assertApiError(response, 404, "auction_not_found");
      });
    } finally {
      try { await app.stop(); }
      finally { assert.ifError((await admin.from(databasePrefix + "_laptops").delete().eq("idempotency_key", idempotencyKey)).error); }
    }
  });
});
