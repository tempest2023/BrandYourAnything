import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { buildLocalApp, localAppEnvironment, localStack, startLocalApp } from "./lib/local-stack.mjs";

test("published layouts and exhausted bid actions in the real browser", { timeout: 180_000 }, async (t) => {
  const local = localStack();
  const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
  // This suite tests rendering and controls, not Stripe network behavior. Actual
  // payment/settlement/refund behavior is covered by test:stripe-e2e.
  const environment = { ...localAppEnvironment(local), STRIPE_SECRET_KEY: "sk_test_LayoutUiNoNetworkCalls" };
  await buildLocalApp(environment);
  const app = await startLocalApp(environment);
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome", headless: true });
  const slugs = []; let userId;
  const context = await browser.newContext({ locale: "en-US", viewport: { width: 1280, height: 900 } });
  const page = await context.newPage(); page.setDefaultTimeout(12_000);
  try {
    const email = `layout-${randomUUID()}@example.test`; const password = randomUUID() + "A!";
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(created.error); userId = created.data.user.id;
    await page.goto(app.baseUrl + "/auth?mode=sign-in&next=/manage");
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL("**/manage");
    await page.getByRole("heading", { name: "Signed in", exact: true }).waitFor();
    let checkoutRequests = 0;
    page.on("request", (request) => { if (request.url().endsWith("/bids/checkout")) checkoutRequests++; });
    for (const baseCount of [6, 10]) await t.test(`${baseCount} spots plus optional logo cover`, async () => {
      try {
      const slug = "layout-ui-" + randomUUID().slice(0, 8); slugs.push(slug);
      await page.goto(app.baseUrl + "/manage");
      await page.evaluate(({ slug, baseCount }) => {
        sessionStorage.setItem("brand-anything-sell-draft", JSON.stringify({ step: 7, furthestStep: 7,
          machine: "mac", ownership: "own", screenSize: "14", layoutCount: baseCount, specialSpot: true,
          specialPrice: "1500.27", smallPrice: "125.13", mediumPrice: "200.13", largePrice: "400.13",
          listingDays: 7, stickerMonths: 12, title: "Logo layout regression", slug }));
      }, { slug, baseCount });
      await page.goto(app.baseUrl + "/sell");
      await page.getByText(`${baseCount + 1} spots, logo covered`, { exact: true }).waitFor();
      const [response] = await Promise.all([
        page.waitForResponse((response) => new URL(response.url()).pathname === "/api/auctions" && response.request().method() === "POST"),
        page.getByRole("button", { name: "Publish your auction", exact: true }).click(),
      ]);
      const publication = await response.json();
      assert.equal(response.status(), 201, JSON.stringify(publication));
      const snapshot = publication.snapshot;
      assert.equal(snapshot.spots.length, baseCount + 1);
      assert.equal(snapshot.spots.at(-1).logoCover, true);
      assert.equal(snapshot.spots.at(-1).minBid, 1500.27);
      assert.equal(snapshot.spots[0].minBid, 400.13);
      assert.equal(snapshot.spots[baseCount === 6 ? 2 : 4].minBid, 150.16, "Premium preserves cents");
      assert.ifError((await admin.from("ba_dev_laptops").update({ stripe_account_id: "acct_layout_fixture_" + randomUUID().replaceAll("-", ""),
        stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("slug", slug)).error);
      await page.goto(app.baseUrl + "/" + slug);
      await page.locator(".lid-spot--logo-cover").waitFor();
      assert.equal(await page.locator(".lid-spot").count(), baseCount + 1);
      assert.equal(await page.locator(".mac-lid .apple-mark").count(), 0);
      for (const width of [1280, 390]) {
        await page.setViewportSize({ width, height: 900 });
        const boxes = await page.locator(".lid-spot").evaluateAll((elements) => elements.map((element) => {
          const r = element.getBoundingClientRect(); return { x: r.x, y: r.y, right: r.right, bottom: r.bottom, width: r.width, height: r.height };
        }));
        for (let i = 0; i < boxes.length; i++) {
          assert.ok(boxes[i].width > 0 && boxes[i].height > 0);
          for (let j = i + 1; j < boxes.length; j++) {
            const overlaps = Math.min(boxes[i].right, boxes[j].right) - Math.max(boxes[i].x, boxes[j].x) > 1
              && Math.min(boxes[i].bottom, boxes[j].bottom) - Math.max(boxes[i].y, boxes[j].y) > 1;
            assert.equal(overlaps, false, `Spots ${i + 1} and ${j + 1} overlap at ${width}px`);
          }
        }
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      await page.locator(".lid-spot--logo-cover").click();
      await page.getByRole("dialog").getByRole("heading", { name: "Over the Apple logo" }).waitFor();
      assert.equal(await page.locator("#bid").inputValue(), "1500.27");
      await page.getByRole("button", { name: "Close", exact: true }).click();
      const auctionId = publication.result.auctionId;
      // UI fixture only: represent a highest possible accepted bid without
      // simulating a payment or creating an unpaid bid through the application.
      assert.ifError((await admin.from("ba_dev_laptop_spots").update({ current_bid_cents: 99999999,
        current_bidder_name: "Limit fixture", bid_count: 1 }).eq("laptop_id", auctionId).eq("position", baseCount + 1)).error);
      await page.reload();
      assert.equal(await page.locator(".lid-spot--logo-cover").isDisabled(), true);
      assert.equal(await page.getByRole("button", { name: "Bid limit reached", exact: true }).isDisabled(), true);
      assert.equal(await page.locator(".lid-spot--1").isDisabled(), false);
      assert.ifError((await admin.from("ba_dev_laptop_spots").update({ opening_bid_cents: 99999999 }).eq("laptop_id", auctionId).eq("position", 1)).error);
      await page.reload(); await page.locator(".lid-spot--1").click();
      assert.equal(await page.locator("#bid").inputValue(), "999999.99");
      assert.equal(await page.locator("#bid").evaluate((input) => input.checkValidity()), true);
      await page.getByRole("button", { name: "Close", exact: true }).click();
      await page.screenshot({ path: `/tmp/auction-layout-${baseCount}.png`, fullPage: false });
      await page.locator(".lid-stage").screenshot({ path: `/tmp/auction-lid-${baseCount}.png` });
      for (const [locale, limitText] of [["zh", "已达出价上限"], ["es", "Límite de puja alcanzado"], ["en", "Bid limit reached"]]) {
        await page.locator(".language-switch select").selectOption(locale);
        assert.equal(await page.getByRole("button", { name: limitText, exact: true }).isDisabled(), true);
        await page.setViewportSize({ width: 390, height: 844 });
        assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth + 1), false, `${locale} mobile overflow`);
      }
      await page.setViewportSize({ width: 1280, height: 900 });
      assert.equal(checkoutRequests, 0);
      } catch (error) {
        await page.screenshot({ path: `/tmp/auction-layout-failure-${baseCount}.png`, fullPage: false });
        console.log("Layout failure page", page.url(), (await page.locator("body").innerText()).slice(-4000));
        throw error;
      }
    });
    await t.test("real 3D model markers and bid panels honor price/closed states", async () => {
      const slug = "layout-model-" + randomUUID().slice(0, 8); slugs.push(slug);
      const form = new FormData();
      for (const [key, value] of Object.entries({ slug, title: "3D limit regression", tagline: "Local model regression",
        story: "An isolated 3D auction fixture for availability and price boundary tests.", objectName: "Tesla Cybertruck",
        assetType: "anything", assetName: "Tesla Cybertruck", presetModelId: "tesla-cybertruck", layoutCount: "1",
        spotLayout: JSON.stringify([{ id: 1, name: "Front face", size: "L", dimensions: "Large panel · Up to 60% of the selected region",
          openingBidCents: 40000, position: [0, 0, 0], normal: [0, 0, 1] }]),
        goalCents: "320000", smallOpeningBidCents: "12500", mediumOpeningBidCents: "20000", largeOpeningBidCents: "40000",
        minIncrementCents: "1000", idempotencyKey: randomUUID(), auctionClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
      })) form.set(key, value);
      const response = await fetch(app.baseUrl + "/api/auctions", { method: "POST", headers: { "X-Auction-Manager-Key": randomUUID() }, body: form });
      const payload = await response.json(); assert.equal(response.status, 201, JSON.stringify(payload));
      assert.ifError((await admin.from("ba_dev_laptops").update({ stripe_account_id: "acct_layout_model_fixture",
        stripe_charges_enabled: true, stripe_payouts_enabled: true }).eq("slug", slug)).error);
      await page.goto(app.baseUrl + "/" + slug);
      await page.getByText("Drag to orbit · scroll to zoom", { exact: true }).waitFor({ timeout: 30_000 });
      assert.equal(await page.locator("canvas").count(), 1);
      const marker = page.getByRole("button", { name: "Spot 1, available", exact: true });
      assert.equal(await marker.isDisabled(), false);
      assert.equal(await page.locator('form button[type="submit"]').isDisabled(), false);
      await page.screenshot({ path: "/tmp/auction-model-ready.png", fullPage: false });
      assert.ifError((await admin.from("ba_dev_laptop_spots").update({ current_bid_cents: 99999999,
        current_bidder_name: "Model limit", bid_count: 1 }).eq("laptop_id", payload.result.auctionId)).error);
      await page.reload();
      assert.equal(await page.getByRole("button", { name: "Spot 1, held by Model limit", exact: true }).isDisabled(), true);
      assert.equal(await page.locator('form button[type="submit"]').count(), 0);
      await page.getByRole("status").filter({ hasText: "Bid limit reached" }).waitFor();
      assert.ifError((await admin.from("ba_dev_laptop_spots").update({ current_bid_cents: null, current_bidder_name: null, bid_count: 0 })
        .eq("laptop_id", payload.result.auctionId)).error);
      assert.ifError((await admin.from("ba_dev_laptops").update({ status: "closed" }).eq("slug", slug)).error);
      await page.reload();
      assert.equal(await marker.isDisabled(), true);
      assert.equal(await page.locator('form button[type="submit"]').count(), 0);
      assert.equal(checkoutRequests, 0);
    });
  } catch (error) {
    await page.screenshot({ path: "/tmp/auction-layout-failure.png", fullPage: false }).catch(() => {});
    throw new Error(`${error.message}\n${app.logs()}`, { cause: error });
  } finally {
    await browser.close(); await app.stop();
    if (slugs.length) assert.ifError((await admin.from("ba_dev_laptops").delete().in("slug", slugs)).error);
    if (userId) assert.ifError((await admin.auth.admin.deleteUser(userId)).error);
  }
});
