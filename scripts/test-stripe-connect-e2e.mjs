import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import nextEnv from "@next/env";
import Stripe from "stripe";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import { localStack, localAppEnvironment, buildLocalApp, startLocalApp } from "./lib/local-stack.mjs";

nextEnv.loadEnvConfig(process.cwd(), false, { info() {}, error(message) { throw new Error(message); } });
const key = process.env.STRIPE_SECRET_KEY?.trim();
assert.match(key || "", /^[sr]k_test_/, "Connect E2E only runs with a Stripe test key.");
const stripe = new Stripe(key);
const local = localStack();
const admin = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
const chromePath = process.env.PLAYWRIGHT_CHROME_PATH || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const interactive = process.env.STRIPE_CONNECT_INTERACTIVE === "1";

async function json(response, status = 200) {
  const value = await response.json(); assert.equal(response.status, status, JSON.stringify(value)); return value;
}

function auctionForm(slug) {
  const form = new FormData();
  for (const [field, value] of Object.entries({
    slug, title: "Stripe onboarding regression", tagline: "Local Connect integration", story: "An isolated auction verifies account onboarding and return synchronization.",
    objectName: "MacBook Pro", assetType: "laptop", assetName: "MacBook Pro", goalCents: "320000",
    smallOpeningBidCents: "12500", mediumOpeningBidCents: "20000", largeOpeningBidCents: "40000", minIncrementCents: "1000",
    auctionClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(), idempotencyKey: randomUUID(),
    layoutCount: "6", spotLayout: JSON.stringify(Array.from({ length: 6 }, (_, index) => ({
      id: index + 1, name: `Spot ${index + 1}`, size: "L", dimensions: "9.5 × 5.5 cm", openingBidCents: 40000,
    }))),
  })) form.set(field, value);
  return form;
}

async function completeSandboxOnboarding(page, baseUrl, email) {
  await page.waitForURL((url) => url.hostname.endsWith("stripe.com"));
  if (interactive) {
    console.log("Complete the Stripe sandbox onboarding in the open test browser. Human verification is not automated; no live account or payment is involved.");
    await page.waitForURL((url) => url.origin === baseUrl && url.pathname === "/manage", { timeout: 10 * 60_000 });
    return;
  }
  for (let step = 0; step < 12; step++) {
    if (page.url().startsWith(baseUrl)) return;
    await page.getByRole("heading").first().waitFor();
    if (await page.getByRole("heading", { name: "Get started with Stripe", exact: true }).isVisible().catch(() => false)) {
      await page.getByLabel("Email address", { exact: true }).fill(email);
      await page.getByRole("button", { name: "Continue", exact: true }).click();
      try { await page.getByRole("heading", { name: "Get started with Stripe", exact: true }).waitFor({ state: "hidden" }); }
      catch (error) {
        if (page.frames().some((frame) => frame.url().includes("hcaptcha.com"))) {
          throw new Error("Stripe hosted onboarding requires human verification. Re-run with STRIPE_CONNECT_INTERACTIVE=1 and complete the sandbox form; this test has not passed.", { cause: error });
        }
        throw error;
      }
      continue;
    }
    const testButton = page.getByRole("button", { name: /use test data|skip this form|complete with test data/i });
    if (await testButton.count() && await testButton.first().isVisible()) {
      await testButton.first().click(); await delay(500); continue;
    }
    throw new Error("Unrecognized Stripe sandbox onboarding step:\n" + await page.locator("body").innerText());
  }
  throw new Error("Stripe sandbox onboarding did not return to the application.");
}

test("published account-owned auction → real Stripe Connect → dashboard readiness", { timeout: interactive ? 15 * 60_000 : 240_000 }, async (t) => {
  const environment = { ...localAppEnvironment(local), STRIPE_SECRET_KEY: key };
  await buildLocalApp(environment);
  const app = await startLocalApp(environment);
  const slug = "connect-e2e-" + randomUUID().slice(0, 8);
  const email = `${slug}@example.com`; const password = "Local-" + randomUUID();
  let userId; let auctionId; let browser; let page;
  try {
    const user = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ifError(user.error); userId = user.data.user.id;
    const client = createClient(local.apiUrl, local.publishableKey, { auth: { persistSession: false } });
    const login = await client.auth.signInWithPassword({ email, password }); assert.ifError(login.error);
    const headers = { Authorization: `Bearer ${login.data.session.access_token}` };
    const published = await json(await fetch(`${app.baseUrl}/api/auctions`, { method: "POST", headers, body: auctionForm(slug) }), 201);
    auctionId = published.result.auctionId;
    const endpoint = `${app.baseUrl}/api/auctions/${slug}`;
    assert.equal((await json(await fetch(endpoint))).campaign.paymentsEnabled, false);
    browser = await chromium.launch({ executablePath: chromePath, headless: !interactive });
    const context = await browser.newContext({ locale: "en-US" });
    page = await context.newPage(); page.setDefaultTimeout(15_000);
    await page.goto(`${app.baseUrl}/auth?mode=sign-in&next=/manage`);
    await page.getByLabel("Email", { exact: true }).fill(email);
    await page.locator('input[autocomplete="current-password"]').fill(password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page.waitForURL(`${app.baseUrl}/manage`);
    await page.getByRole("heading", { name: "Stripe onboarding regression" }).waitFor();
    // One click reaches Stripe's hosted onboarding. The dashboard pre-fills the
    // country; Stripe collects the business, bank and capability details.
    assert.equal(await page.getByLabel("Business country").inputValue(), "US");
    const response = page.waitForResponse((r) => r.url().endsWith(`/${slug}/stripe/connect`) && r.request().method() === "POST");
    await page.getByRole("button", { name: "Connect Stripe", exact: true }).click();
    const started = await response;
    assert.equal(started.status(), 200, started.status() === 200 ? undefined : await started.text());
    await completeSandboxOnboarding(page, app.baseUrl, email);
    await page.waitForURL((url) => url.origin === app.baseUrl && url.pathname === "/manage");
    await page.getByText("Stripe payments are ready.", { exact: true }).waitFor();
    const status = await json(await fetch(`${endpoint}/stripe/connect`, { headers }));
    assert.equal(status.ready, true);
    assert.equal((await json(await fetch(endpoint))).campaign.paymentsEnabled, true);
    await page.goto(`${app.baseUrl}/${slug}`);
    assert.ok(await page.locator(".outbid-button:not(:disabled)").count() > 0);
  } catch (error) {
    t.diagnostic(app.logs());
    if (page) t.diagnostic(await page.locator("body").innerText().catch(() => "Page unavailable."));
    if (page) {
      await page.screenshot({ path: "/tmp/brand-connect-e2e-failure.png", fullPage: true });
      t.diagnostic(JSON.stringify(await page.locator("input").evaluateAll((inputs) => inputs.map((input) => ({
        type: input.type, name: input.name, valid: input.validity.valid, message: input.validationMessage,
        labels: Array.from(input.labels || [], (label) => label.textContent),
      })))));
      t.diagnostic(JSON.stringify(page.frames().map((frame) => { try { return new URL(frame.url()).hostname; } catch { return "blank"; } })));
    }
    throw error;
  }
  finally {
    await browser?.close();
    await app.stop();
    const row = await admin.from("ba_dev_laptops").select("id,stripe_account_id").eq("slug", slug).maybeSingle();
    assert.ifError(row.error);
    if (row.data?.stripe_account_id) {
      const account = await stripe.v2.core.accounts.retrieve(row.data.stripe_account_id);
      assert.equal(account.livemode, false); assert.equal(account.metadata?.brand_anything_auction_id, row.data.id);
      if (!account.closed) await stripe.v2.core.accounts.close(account.id, { applied_configurations: account.applied_configurations });
    }
    if (auctionId) assert.ifError((await admin.from("ba_dev_laptops").delete().eq("id", auctionId)).error);
    if (userId) assert.ifError((await admin.auth.admin.deleteUser(userId)).error);
  }
});
