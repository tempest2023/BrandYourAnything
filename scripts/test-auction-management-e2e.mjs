import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { buildLocalApp, localAppEnvironment, localStack, startLocalApp } from "./lib/local-stack.mjs";
import { paymentNoticeChecks } from "./lib/payment-notice-checks.mjs";

const local = localStack();
const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

async function json(response, status = 200) {
  const result = await response.json();
  assert.equal(response.status, status, JSON.stringify(result));
  return result;
}

function auctionForm(slug) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    slug, title: "Management regression auction", tagline: "Local lifecycle regression",
    story: "An isolated auction used to verify ownership and closure.", objectName: "MacBook Pro",
    layoutCount: "6", spotLayout: JSON.stringify(Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, name: `Spot ${index + 1}`, size: "L", dimensions: "9.5 × 5.5 cm", openingBidCents: 40000,
    }))),
    assetType: "laptop", assetName: "MacBook Pro", goalCents: "320000", smallOpeningBidCents: "12500",
    mediumOpeningBidCents: "20000", largeOpeningBidCents: "40000", minIncrementCents: "1000",
    auctionClosesAt: new Date(Date.now() + 86_400_000 * 7).toISOString(), idempotencyKey: randomUUID(),
  })) form.set(key, value);
  return form;
}

test("auction ownership and public lifecycle on isolated local dev/prod namespaces", { timeout: 240_000 }, async (t) => {
  await buildLocalApp(localAppEnvironment(local));
  const browser = await chromium.launch({ executablePath: chromePath, headless: true });
  try {
    for (const prefix of ["ba_dev", "ba_prod"]) await t.test(prefix, async (t) => {
      const app = await startLocalApp(localAppEnvironment(local, prefix));
      const context = await browser.newContext({ locale: "en-US" });
      const page = await context.newPage();
      page.setDefaultTimeout(10_000);
      const slug = `manage-e2e-${randomUUID().slice(0, 8)}`;
      const key = randomUUID();
      const manager = { "X-Auction-Manager-Key": key };
      const userIds = [];
      const uploadedPaths = [];
      try {
        const create = await json(await fetch(`${app.baseUrl}/api/auctions`, { method: "POST", headers: manager, body: auctionForm(slug) }), 201);
        assert.ok(create.location.endsWith(`/${slug}`));
        const endpoint = `${app.baseUrl}/api/auctions/${slug}`;
        await t.test("public readiness and private management boundaries", async () => {
          const snapshot = await json(await fetch(endpoint));
          assert.equal(snapshot.campaign.status, "published");
          assert.equal(snapshot.campaign.paymentsEnabled, false);
          const privateState = await json(await fetch(`${endpoint}/manage`, { headers: manager }));
          assert.equal(privateState.auction.claimedByAccount, false);
          await json(await fetch(`${endpoint}/manage`), 401);
          await json(await fetch(`${endpoint}/manage`, { headers: { "X-Auction-Manager-Key": randomUUID() } }), 404);
          const other = prefix === "ba_dev" ? "ba_prod" : "ba_dev";
          const { data, error } = await admin.from(`${other}_laptops`).select("id").eq("slug", slug);
          assert.ifError(error);
          assert.equal(data.length, 0);
          await page.goto(`${app.baseUrl}/${slug}`);
          await page.getByText("Bidding will open when the seller finishes Stripe setup.").waitFor();
          assert.equal(await page.locator(".outbid-button:not(:disabled)").count(), 0);
        });

        await t.test("recovery import survives reload and cancellation is visible", async () => {
          await page.goto(`${app.baseUrl}/manage`);
          await page.getByLabel("Auction address", { exact: true }).fill(`${app.baseUrl}/${slug}`);
          await page.getByLabel("Recovery code", { exact: true }).fill(key);
          await page.getByRole("button", { name: "Verify and add" }).click();
          await page.getByRole("heading", { name: "Management regression auction" }).waitFor();
          await page.reload();
          await page.getByRole("heading", { name: "Management regression auction" }).waitFor();
          await page.goto(`${app.baseUrl}/${slug}?payment=cancelled`);
          await page.getByText("Checkout cancelled. No new bid was placed.").waitFor();
          assert.equal(new URL(page.url()).searchParams.has("payment"), false);
        });

        await t.test("laptop payment-return UI handles every confirmation outcome", (t) =>
          paymentNoticeChecks(t, { page, baseUrl: app.baseUrl, slug, endpoint, model: false, prefix }));

        await t.test("signed model draft previews survive refresh and reject forged claims", async () => {
          const bytes = new TextEncoder().encode("o Preview\nv 0 0 0\nv 1 0 0\nv 0 1 0\nf 1 2 3\n");
          const fileName = "preview-regression.obj";
          const ticket = await json(await fetch(`${app.baseUrl}/api/models/upload-ticket`, {
            method: "POST", headers: { ...manager, "Content-Type": "application/json" }, body: JSON.stringify({ fileName, size: bytes.length }),
          }));
          assert.equal(ticket.bucket, `${prefix}_brand_models`);
          uploadedPaths.push(ticket.path);
          const client = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
          assert.ifError((await client.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType: ticket.contentType })).error);
          const reference = { path: ticket.path, fileName, size: bytes.length, uploadClaim: ticket.uploadClaim };
          const preview = (body) => fetch(`${app.baseUrl}/api/models/preview-url`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
          await json(await preview({ ...reference, uploadClaim: "0".repeat(64) }), 403);
          await json(await preview({ ...reference, size: bytes.length + 1 }), 403);
          const result = await json(await preview(reference));
          const imageResponse = await fetch(result.sourceUrl);
          assert.equal(imageResponse.status, 200);
          assert.deepEqual(new Uint8Array(await imageResponse.arrayBuffer()), bytes);
          await page.evaluate((brandModel) => sessionStorage.setItem("brand-anything-sell-draft", JSON.stringify({
            machine: "anything", modelMode: "custom", anythingSource: "model", assetName: "Preview fixture", brandModel,
          })), { storagePath: ticket.path, uploadClaim: ticket.uploadClaim, fileName, size: bytes.length, format: "obj" });
          const restored = page.waitForResponse((response) => response.url().includes("/api/models/preview-url") && response.status() === 200);
          await page.goto(`${app.baseUrl}/sell`);
          await restored;
          const refreshed = page.waitForResponse((response) => response.url().includes("/api/models/preview-url") && response.status() === 200);
          await page.reload();
          await refreshed;
          await page.evaluate(() => sessionStorage.removeItem("brand-anything-sell-draft"));
        });

        await t.test("public view switches to a repaired model and reloads same-name replacements, not renewed signatures", async () => {
          await page.goto(`${app.baseUrl}/${slug}`);
          const initial = await json(await fetch(endpoint));
          let version = initial.campaign.assetVersion;
          const fileName = "same-name.obj";
          const requestedModels = [];
          const track = (request) => { if (request.url().includes("/brand_models/") || request.url().includes("_brand_models/")) requestedModels.push(request.url().split("?", 1)[0]); };
          page.on("request", track);
          try {
            for (let i = 0; i < 2; i++) {
              const bytes = new TextEncoder().encode(`o Model${i}\nv 0 0 0\nv ${1 + i} 0 0\nv 0 1 0\nv 0 0 1\nf 1 2 3\nf 1 4 2\nf 1 3 4\nf 2 4 3\n`);
              const ticket = await json(await fetch(`${app.baseUrl}/api/models/upload-ticket`, {
                method: "POST", headers: { ...manager, "Content-Type": "application/json" }, body: JSON.stringify({ fileName, size: bytes.length }),
              }));
              uploadedPaths.push(ticket.path);
              const client = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
              assert.ifError((await client.storage.from(ticket.bucket).uploadToSignedUrl(ticket.path, ticket.token, bytes, { contentType: ticket.contentType })).error);
              const nextModel = page.waitForResponse((response) => response.url().includes(ticket.path) && response.status() === 200, { timeout: 20_000 });
              const repaired = await json(await fetch(`${endpoint}/model`, {
                method: "PUT", headers: { ...manager, "Content-Type": "application/json" },
                body: JSON.stringify({ assetName: "Repaired object", expectedAssetVersion: version, path: ticket.path, fileName, size: bytes.length, uploadClaim: ticket.uploadClaim }),
              }));
              version = repaired.snapshot.campaign.assetVersion;
              assert.deepEqual(new Uint8Array(await (await nextModel).body()), bytes);
              await page.getByText("Drag to orbit · scroll to zoom", { exact: true }).waitFor();
              assert.equal(await page.locator("canvas").count(), 1);
              const before = requestedModels.length;
              await page.waitForResponse((response) => response.url() === endpoint && response.status() === 200, { timeout: 10_000 });
              assert.equal(requestedModels.length, before, "Renewing a signed URL must not reload the model");
            }
            assert.equal(new Set(requestedModels).size, 2, "Both same-name model revisions were actually fetched");
            assert.equal(await page.locator(".mac-lid").count(), 0, "A generic object must not fall back to a MacBook lid");
            const modelPath = uploadedPaths.at(-1);
            const matcher = (url) => url.pathname.includes(modelPath);
            let abortOnce = true;
            await page.route(matcher, (route) => {
              if (abortOnce) { abortOnce = false; return route.abort("failed"); }
              return route.continue();
            });
            await page.reload();
            await page.getByRole("button", { name: "Retry loading model", exact: true }).click();
            await page.getByText("Drag to orbit · scroll to zoom", { exact: true }).waitFor();
            await page.unroute(matcher);
            await page.locator("canvas").screenshot({ path: `/tmp/model-repair-${prefix}.png` });
          } finally { page.off("request", track); }
        });

        await t.test("rendered 3D payment-return UI handles every confirmation outcome", (t) =>
          paymentNoticeChecks(t, { page, baseUrl: app.baseUrl, slug, endpoint, model: true, prefix }));

        const users = [];
        for (let index = 0; index < 2; index++) {
          const email = `management-${randomUUID()}@example.test`;
          const password = `Regression-${randomUUID()}!`;
          const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
          assert.ifError(error);
          userIds.push(data.user.id);
          const client = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false, autoRefreshToken: false } });
          const auth = await client.auth.signInWithPassword({ email, password });
          assert.ifError(auth.error);
          users.push({ email, password, headers: { Authorization: `Bearer ${auth.data.session.access_token}` } });
        }
        await t.test("atomic account claim, recovery rotation and revocation", async () => {
          const claimed = await json(await fetch(`${endpoint}/manage`, { method: "POST", headers: { ...manager, ...users[0].headers } }));
          assert.equal(claimed.auction.claimedByAccount, true);
          await json(await fetch(`${endpoint}/manage`, { method: "POST", headers: { ...manager, ...users[1].headers } }), 409);
          const mine = await json(await fetch(`${app.baseUrl}/api/auctions/mine`, { headers: users[0].headers }));
          assert.ok(mine.auctions.some((auction) => auction.slug === slug));
          const stranger = await json(await fetch(`${app.baseUrl}/api/auctions/mine`, { headers: users[1].headers }));
          assert.equal(stranger.auctions.length, 0);
          const rotated = randomUUID();
          await json(await fetch(`${endpoint}/manage`, { method: "PATCH", headers: { ...users[0].headers, "Content-Type": "application/json" }, body: JSON.stringify({ recoveryAction: "rotate", recoveryCode: rotated }) }));
          await json(await fetch(`${endpoint}/manage`, { headers: manager }), 404);
          await json(await fetch(`${endpoint}/manage`, { headers: { "X-Auction-Manager-Key": rotated } }));
          await json(await fetch(`${endpoint}/manage`, { method: "PATCH", headers: { ...users[0].headers, "Content-Type": "application/json" }, body: JSON.stringify({ recoveryAction: "disable" }) }));
          await json(await fetch(`${endpoint}/manage`, { method: "PATCH", headers: { "X-Auction-Manager-Key": rotated, "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed" }) }), 404);
        });

        await t.test("shared email sign-in returns to dashboard and lists owned auctions", async () => {
          await page.goto(`${app.baseUrl}/auth?mode=sign-in&next=/manage`);
          await page.getByLabel("Email", { exact: true }).fill(users[0].email);
          await page.locator('input[autocomplete="current-password"]').fill(users[0].password);
          await page.getByRole("button", { name: "Sign in", exact: true }).click();
          await page.waitForURL(`${app.baseUrl}/manage`);
          await page.getByRole("heading", { name: "Management regression auction" }).waitFor();
          await page.getByText("Account-owned", { exact: true }).waitFor();
        });

        await t.test("concurrent repeated closure remains public and disables all bid actions", async () => {
          const results = await Promise.all(Array.from({ length: 8 }, () => fetch(`${endpoint}/manage`, {
            method: "PATCH", headers: { ...users[0].headers, "Content-Type": "application/json" }, body: JSON.stringify({ status: "closed" }),
          }).then((response) => json(response))));
          assert.ok(results.every((result) => result.auction.status === "closed"));
          const snapshot = await json(await fetch(endpoint));
          assert.equal(snapshot.campaign.status, "closed");
          await page.goto(`${app.baseUrl}/${slug}`);
          await page.getByText("Auction closed. Final results remain available below.").waitFor();
          assert.equal(await page.locator(".outbid-button:not(:disabled), .lid-spot:not(:disabled)").count(), 0);
        });
      } catch (error) {
        t.diagnostic(app.logs());
        throw error;
      } finally {
        await context.close();
        const { error } = await admin.from(`${prefix}_laptops`).delete().eq("slug", slug);
        assert.ifError(error);
        if (uploadedPaths.length) assert.ifError((await admin.storage.from(`${prefix}_brand_models`).remove(uploadedPaths)).error);
        for (const id of userIds) assert.ifError((await admin.auth.admin.deleteUser(id)).error);
        await app.stop();
      }
    });
  } finally { await browser.close(); }
});
