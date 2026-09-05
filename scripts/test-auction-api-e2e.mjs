import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:net";
import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";
import test from "node:test";

const projectRoot = process.cwd();
const { loadEnvConfig } = nextEnv;
loadEnvConfig(projectRoot, false, {
  info() {},
  error(message) {
    throw new Error(message);
  },
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseSecretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const databasePrefix = process.env.SUPABASE_DATABASE_PREFIX || "ba_dev";

if (!supabaseUrl || !supabaseSecretKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(supabaseUrl)
  && process.env.ALLOW_REMOTE_API_E2E !== "1") {
  throw new Error("Auction API E2E tests only run locally unless ALLOW_REMOTE_API_E2E=1.");
}
if (!["ba_dev", "ba_prod"].includes(databasePrefix)) {
  throw new Error("SUPABASE_DATABASE_PREFIX must be ba_dev or ba_prod.");
}

const genericRpcNames = [
  `${databasePrefix}_create_auction`,
  `${databasePrefix}_configure_auction_spots`,
  `${databasePrefix}_place_auction_bid`,
];
const legacyRpcNames = [
  `${databasePrefix}_create_laptop`,
  `${databasePrefix}_configure_laptop_spots`,
  `${databasePrefix}_place_laptop_bid`,
];

function assertLocalAppUrl(value) {
  const url = new URL(value);
  if (!["127.0.0.1", "localhost"].includes(url.hostname)
    && process.env.ALLOW_REMOTE_API_E2E !== "1") {
    throw new Error("API_E2E_BASE_URL must be local unless ALLOW_REMOTE_API_E2E=1.");
  }
  return url.origin;
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  const { port } = address;
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return port;
}

async function startApp() {
  if (process.env.API_E2E_BASE_URL) {
    return {
      baseUrl: assertLocalAppUrl(process.env.API_E2E_BASE_URL),
      logs: () => "The E2E suite used an externally managed Next.js server.",
      stop: async () => {},
    };
  }

  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const child = spawn(process.execPath, [nextBin, "start", ".", "-H", "127.0.0.1", "-p", String(port)], {
    cwd: projectRoot,
    env: { ...process.env, NEXT_TELEMETRY_DISABLED: "1" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const remember = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) {
      throw new Error(`Next.js exited before the API became ready.\n${output}`);
    }
    try {
      const response = await fetch(`${baseUrl}/api/auth/x-status`, { signal: AbortSignal.timeout(1_000) });
      await response.body?.cancel();
      return {
        baseUrl,
        logs: () => output,
        stop: async () => {
          if (child.exitCode !== null) return;
          child.kill("SIGTERM");
          await Promise.race([once(child, "exit"), delay(5_000)]);
          if (child.exitCode === null) child.kill("SIGKILL");
        },
      };
    } catch {
      await delay(250);
    }
  }

  child.kill("SIGTERM");
  throw new Error(`Next.js did not become ready within 30 seconds.\n${output}`);
}

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

function bidForm({ idempotencyKey, amountCents = 7_998_100 }) {
  const form = new FormData();
  form.set("spotId", "1");
  form.set("amountCents", String(amountCents));
  form.set("brandName", "API E2E Brand");
  form.set("email", "api-e2e@example.com");
  form.set("website", "https://example.com/e2e");
  form.set("xHandle", "api_e2e");
  form.set("idempotencyKey", idempotencyKey);
  return form;
}

async function fetchOpenApi() {
  const response = await fetch(`${supabaseUrl}/rest/v1/`, {
    headers: {
      Accept: "application/openapi+json",
      apikey: supabaseSecretKey,
      Authorization: `Bearer ${supabaseSecretKey}`,
    },
  });
  assert.equal(response.status, 200, "Supabase REST OpenAPI should be available");
  return readJson(response);
}

test("auction HTTP API", { timeout: 120_000 }, async (t) => {
  const app = await startApp();
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

    await t.test("validates, accepts, retries, and rejects bids through HTTP", async () => {
      const invalid = await fetch(`${auctionUrl}/bids`, { method: "POST", body: new FormData() });
      await assertApiError(invalid, 400, "invalid_bid");

      const bidKey = randomUUID();
      const accepted = await fetch(`${auctionUrl}/bids`, {
        method: "POST",
        body: bidForm({ idempotencyKey: bidKey }),
      });
      const acceptedBody = await readJson(accepted);
      assert.equal(accepted.status, 201, `Bid failed: ${JSON.stringify(acceptedBody)}\n${app.logs()}`);
      assert.equal(acceptedBody.result.accepted, true);
      assert.equal(acceptedBody.result.reason, "accepted");
      assert.equal(acceptedBody.result.currentBid, 79_981);
      assert.equal(acceptedBody.result.minimumNextBid, 79_991);
      assert.equal(acceptedBody.snapshot.spots[0].holder, "API E2E Brand");

      const retry = await fetch(`${auctionUrl}/bids`, {
        method: "POST",
        body: bidForm({ idempotencyKey: bidKey }),
      });
      const retryBody = await readJson(retry);
      assert.equal(retry.status, 200);
      assert.equal(retryBody.result.reason, "already_processed");
      assert.equal(retryBody.result.bidId, acceptedBody.result.bidId);

      const tooLow = await fetch(`${auctionUrl}/bids`, {
        method: "POST",
        body: bidForm({ idempotencyKey: randomUUID() }),
      });
      const tooLowBody = await assertApiError(tooLow, 409, "bid_too_low");
      assert.equal(tooLowBody.result.minimumNextBid, 79_991);

      const refreshed = await fetch(auctionUrl);
      const snapshot = await readJson(refreshed);
      assert.equal(refreshed.status, 200);
      assert.equal(snapshot.spots[0].bids, 1);
      assert.equal(snapshot.history[0].brand, "API E2E Brand");
      assert.equal(snapshot.history[0].amount, 79_981);
    });

    await t.test("returns a coded 404 for an unknown auction", async () => {
      const response = await fetch(`${createUrl}/missing-${randomUUID().slice(0, 8)}`);
      await assertApiError(response, 404, "auction_not_found");
    });
  } finally {
    await app.stop();
  }
});
