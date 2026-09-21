import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { buildLocalApp, localAppEnvironment, localStack, startLocalApp } from "./lib/local-stack.mjs";

async function assertPaymentCopy(page, model = false) {
  for (const [locale, total, balance] of [
    ["en", "in leading bids", "The remaining 80% is not collected automatically."],
    ["zh", "领先出价总额", "剩余 80% 不会自动收取。"],
    ["es", "en pujas líderes", "El 80 % restante no se cobra automáticamente."],
  ]) {
    await page.locator(".language-switch select").selectOption(locale);
    await page.locator(model ? "header" : "#top").getByText(total, { exact: !model }).waitFor();
    if (!model) await page.locator(".lid-spot--1").click();
    const form = model ? page.locator('form:has(input[name="brandName"])') : page.getByRole("dialog");
    await form.getByText(balance, { exact: false }).waitFor();
    await page.setViewportSize({ width: 390, height: 844 });
    assert.equal(await form.evaluate((element) => element.scrollWidth > element.clientWidth + 1), false, `${locale} payment disclosure must not overflow`);
    if (locale === "en") await page.screenshot({ path: `/tmp/payment-copy-${model ? "3d" : "laptop"}.png` });
    if (!model) {
      await form.locator('input[name="logo"]').setInputFiles({ name: "visible-logo.png", mimeType: "image/png",
        buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=", "base64") });
      const expected = { en: "Selected for upload", zh: "已选择，待上传", es: "Seleccionado para subir" }[locale];
      await form.getByText(expected, { exact: true }).waitFor();
      await form.locator(".dialog-close").click();
      const question = { en: "How does payment work?", zh: "如何付款？", es: "¿Cómo funciona el pago?" }[locale];
      // The summary appends a decorative "+" span, so an exact text match finds
      // no element. Match the question as part of the disclosure's text instead.
      const faq = page.locator("details").filter({ hasText: question });
      await faq.locator("summary").click();
      const answer = await faq.locator(".faq-answer").innerText();
      assert.match(answer, /Stripe/); assert.match(answer, /20/); assert.match(answer, /80/);
      await faq.locator("summary").click();
    }
  }
  await page.locator(".language-switch select").selectOption("en");
  await page.setViewportSize({ width: 1280, height: 900 });
}

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
      await page.getByText("For a $100 bid, the deposit is $20 and the platform fee is $10", { exact: false }).waitFor();
      await page.getByText("This version does not automatically collect the remaining 80%.", { exact: false }).waitFor();
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
      const auctionFooter = page.locator(".site-footer");
      assert.equal(await auctionFooter.locator(".footer-avatar, .footer-title, .footer-support-links").count(), 0);
      await auctionFooter.getByRole("link", { name: "Privacy Policy", exact: true }).waitFor();
      await auctionFooter.getByRole("link", { name: "Terms of Service", exact: true }).waitFor();
      await auctionFooter.getByRole("link", { name: "Source on GitHub", exact: true }).waitFor();
      await auctionFooter.getByText("Brand Anything is not affiliated with", { exact: false }).waitFor();
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
      await assertPaymentCopy(page);
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
      await assertPaymentCopy(page, true);
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
    await t.test("terms explain the actual deposit flow without changing the privacy revision", async () => {
      await page.goto(app.baseUrl + "/terms");
      await page.getByText("September 13, 2026", { exact: true }).waitFor();
      await page.getByText("10% of the full bid amount, deducted from the 20% deposit", { exact: true }).waitFor();
      await page.getByText("It does not automatically collect the remaining 80% when the auction closes.", { exact: false }).waitFor();
      await page.goto(app.baseUrl + "/privacy");
      await page.getByText("September 4, 2026", { exact: true }).waitFor();
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
