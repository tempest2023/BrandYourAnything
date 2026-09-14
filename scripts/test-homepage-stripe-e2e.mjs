import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { once } from "node:events";
import { readFileSync } from "node:fs";
import { createServer } from "node:net";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";

import nextEnv from "@next/env";
import { createClient } from "@supabase/supabase-js";
import { chromium } from "playwright-core";
import Stripe from "stripe";
import test from "node:test";
import { buildLocalApp, localAppEnvironment, localStack } from "./lib/local-stack.mjs";

const projectRoot = process.cwd();
const { loadEnvConfig } = nextEnv;
loadEnvConfig(projectRoot, false, {
  info() {},
  error(message) {
    throw new Error(message);
  },
});

const stripeKey = process.env.STRIPE_SECRET_KEY?.trim();
if (!stripeKey || !/^[sr]k_test_/.test(stripeKey)) {
  throw new Error("test:stripe-e2e requires a Stripe test-mode STRIPE_SECRET_KEY.");
}

const chromePath = process.env.PLAYWRIGHT_CHROME_PATH
  || "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";
const stripe = new Stripe(stripeKey);

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: projectRoot,
    encoding: "utf8",
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(" ")} failed:\n${result.stdout || ""}${result.stderr || ""}`);
  }
  return result.stdout.trim();
}

function localSupabaseEnvironment() {
  return localStack();
}

function databaseContainer() {
  const config = readFileSync(`${projectRoot}/supabase/config.toml`, "utf8");
  const projectId = config.match(/^project_id\s*=\s*"([^"]+)"/m)?.[1];
  if (!projectId) throw new Error("supabase/config.toml is missing project_id.");
  const name = `supabase_db_${projectId}`;
  const running = run("docker", ["ps", "--format", "{{.Names}}"])
    .split("\n")
    .includes(name);
  if (!running) throw new Error(`Local Supabase database container ${name} is not running.`);
  return name;
}

function sql(container, statement, tuplesOnly = false) {
  const args = ["exec", "-i", container, "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1"];
  if (tuplesOnly) args.push("-A", "-t", "-q");
  const result = spawnSync("docker", args, {
    cwd: projectRoot,
    input: statement,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(`Local fixture SQL failed:\n${result.stderr || result.stdout}`);
  return result.stdout.trim();
}

function sqlString(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

function createFixture(container, fixtureSlug, model = false) {
  const accountRow = sql(
    container,
    "select stripe_account_id || '|' || slug from public.ba_dev_laptops where stripe_account_id is not null limit 1;",
    true,
  );
  const [accountId, accountOwnerSlug] = accountRow.split("|");
  if (!accountId.startsWith("acct_")) {
    throw new Error("The local ba_dev homepage auction needs a Stripe test connected account.");
  }
  sql(container, `
    begin;
    insert into public.ba_dev_laptops (
      slug, owner_name, owner_email, title, tagline, story, laptop_model,
      goal_cents, small_opening_bid_cents, medium_opening_bid_cents,
      large_opening_bid_cents, min_increment_cents, auction_closes_at,
      status, idempotency_key, stripe_account_id, stripe_charges_enabled,
      stripe_payouts_enabled, is_default
    ) values (
      ${sqlString(fixtureSlug)}, 'Stripe E2E', 'stripe-e2e@example.com',
      'Stripe E2E homepage auction', 'Real Checkout Bid and Outbid regression',
      'An isolated local campaign used to verify the complete paid auction flow.',
      'MacBook Pro 14-inch', 320000, 12500, 20000, 40000, 1000,
      clock_timestamp() + interval '1 day', 'published', ${sqlString(randomUUID())},
      ${sqlString(accountId)}, true, true, false
    );
    insert into public.ba_dev_laptop_spots (
      laptop_id, position, name, size, dimensions, opening_bid_cents, min_increment_cents
    )
    select id, 2, 'Marquee — above the logo', 'L', '9.5 × 5.5 cm', 40000, 1000
      from public.ba_dev_laptops where slug = ${sqlString(fixtureSlug)};
    ${model ? `insert into public.ba_dev_campaign_assets
      (laptop_id, asset_type, asset_name, model_storage_path, model_file_name, idempotency_key)
      select id, 'anything', 'Tesla Cybertruck', 'preset:tesla-cybertruck', 'tesla-cybertruck.glb', ${sqlString(randomUUID())}
      from public.ba_dev_laptops where slug = ${sqlString(fixtureSlug)};` : ""}
    commit;
  `);
  const laptopId = sql(
    container,
    `select id from public.ba_dev_laptops where slug = ${sqlString(fixtureSlug)};`,
    true,
  );
  return { accountId, accountOwnerSlug, laptopId, slug: fixtureSlug };
}

function removeFixture(container, fixtureSlug) {
  sql(container, `
    begin;
    delete from public.ba_dev_laptops where slug = ${sqlString(fixtureSlug)};
    commit;
  `);
}

async function reservePort() {
  const server = createServer();
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  return address.port;
}

async function stopChild(child) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([once(child, "exit"), delay(5_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

function stripeWebhookSecret() {
  const secret = run("stripe", ["listen", "--print-secret", "--skip-update"], {
    env: { ...process.env, STRIPE_API_KEY: stripeKey },
  });
  if (!secret.startsWith("whsec_")) throw new Error("Stripe CLI did not return a webhook secret.");
  return secret;
}

function startStripeListener(baseUrl) {
  const endpoint = `${baseUrl}/api/stripe/webhook`;
  const child = spawn("stripe", [
    "listen", "--skip-update",
    "--events", "checkout.session.completed,checkout.session.async_payment_succeeded,checkout.session.expired",
    "--forward-to", endpoint,
    "--forward-connect-to", endpoint,
  ], {
    cwd: projectRoot,
    env: { ...process.env, STRIPE_API_KEY: stripeKey },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const remember = (chunk) => {
    output = `${output}${chunk}`.slice(-20_000);
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);
  return { child, logs: () => output };
}

async function waitForListener(listener) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if (listener.child.exitCode !== null) throw new Error(`Stripe listener exited:\n${listener.logs()}`);
    if (/Ready!|webhook signing secret/i.test(listener.logs())) return;
    await delay(250);
  }
  throw new Error(`Stripe listener did not become ready:\n${listener.logs()}`);
}

async function startApp(baseUrl, webhookSecret, local, fixtureSlug) {
  const nextBin = fileURLToPath(new URL("../node_modules/next/dist/bin/next", import.meta.url));
  const child = spawn(process.execPath, [
    nextBin, "start", ".", "-H", "127.0.0.1", "-p", new URL(baseUrl).port,
  ], {
    cwd: projectRoot,
    env: {
      ...localAppEnvironment(local),
      NEXT_PUBLIC_SITE_URL: baseUrl,
      STRIPE_SECRET_KEY: stripeKey,
      STRIPE_WEBHOOK_SECRET: webhookSecret,
      STRIPE_CONNECT_WEBHOOK_SECRET: webhookSecret,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  const remember = (chunk) => {
    output = `${output}${chunk}`.slice(-30_000);
  };
  child.stdout.on("data", remember);
  child.stderr.on("data", remember);

  for (let attempt = 0; attempt < 120; attempt += 1) {
    if (child.exitCode !== null) throw new Error(`Next.js exited before becoming ready:\n${output}`);
    try {
      const response = await fetch(`${baseUrl}/api/auctions/${fixtureSlug}`, {
        signal: AbortSignal.timeout(1_000),
      });
      if (response.ok) {
        await response.body?.cancel();
        return { child, logs: () => output };
      }
    } catch {
      // Continue until the local production server accepts requests.
    }
    await delay(250);
  }
  throw new Error(`Next.js did not become ready:\n${output}`);
}

async function fillFirstVisible(page, selectors, value, required = true) {
  const deadline = Date.now() + (required ? 30_000 : 2_000);
  while (Date.now() < deadline) {
    for (const frame of page.frames()) {
      for (const selector of selectors) {
        const locator = frame.locator(selector).first();
        if (await locator.count() && await locator.isVisible().catch(() => false)) {
          await locator.fill(value);
          return true;
        }
      }
    }
    await delay(250);
  }
  if (required) throw new Error(`Could not find Stripe Checkout field: ${selectors.join(", ")}`);
  return false;
}

async function completeStripeCheckout(page, accountId) {
  await page.waitForURL((url) => url.hostname.endsWith("stripe.com"), {
    timeout: 30_000,
    waitUntil: "commit",
  });
  await fillFirstVisible(page, [
    'input[name="cardNumber"]', 'input[autocomplete="cc-number"]', 'input[placeholder*="1234"]',
  ], "4242424242424242");
  await fillFirstVisible(page, [
    'input[name="cardExpiry"]', 'input[autocomplete="cc-exp"]', 'input[placeholder*="MM"]',
  ], "1234");
  await fillFirstVisible(page, [
    'input[name="cardCvc"]', 'input[autocomplete="cc-csc"]', 'input[placeholder="CVC"]',
  ], "123");
  await fillFirstVisible(page, [
    'input[name="billingName"]', 'input[autocomplete="cc-name"]', 'input[placeholder*="name"]',
  ], "Stripe E2E", false);
  await fillFirstVisible(page, [
    'input[name="billingPostalCode"]', 'input[autocomplete="postal-code"]', 'input[placeholder*="ZIP"]',
  ], "94107", false);

  const saveToLink = page.locator('input[name="enableStripePass"]');
  if (await saveToLink.isChecked().catch(() => false)) await saveToLink.uncheck();
  const agentDisclosure = page.locator('input[type="checkbox"][tabindex="-1"]');
  if (await agentDisclosure.count()) {
    await agentDisclosure.evaluate((element) => element.click());
  }

  const sessionId = page.url().match(/\/(cs_test_[A-Za-z0-9]+)/)?.[1];
  if (!sessionId) throw new Error("Could not read the Checkout Session ID from Stripe's URL.");
  await page.locator('[data-testid="hosted-payment-submit-button"]').click();
  let paidSession;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    paidSession = await stripe.checkout.sessions.retrieve(
      sessionId,
      {},
      { stripeAccount: accountId },
    );
    if (paidSession.status === "complete" && paidSession.payment_status === "paid") break;
    await delay(250);
  }
  assert.equal(paidSession?.payment_status, "paid", "Stripe test card payment did not complete.");
  const returnUrl = paidSession.success_url.replace("{CHECKOUT_SESSION_ID}", sessionId);
  await page.goto(returnUrl, { waitUntil: "commit" });
}

async function placeBid(page, accountId, { amount, brand, email, logo }, model = false) {
  if (model) await page.getByRole("button", { name: /^Spot 2, / }).click();
  else await page.locator(".lid-spot--2").click();
  const dialog = model ? page.locator('form:has(input[name="brandName"])') : page.locator("dialog[open]");
  await dialog.locator('input[type="number"]').fill(String(amount));
  await dialog.locator('input[name="brandName"]').fill(brand);
  await dialog.locator('input[name="email"]').fill(email);
  await dialog.locator('input[name="website"]').fill(`https://${brand.toLowerCase().replaceAll(" ", "-")}.example.com`);
  if (logo) await dialog.locator('input[name="logo"]').setInputFiles(logo);
  await dialog.locator('button[type="submit"]').click();
  try {
    await completeStripeCheckout(page, accountId);
  } catch (error) {
    const formError = await dialog.locator('[role="alert"], .bid-error').textContent().catch(() => null);
    throw new Error(
      `Checkout navigation failed at ${page.url()}${formError ? `: ${formError}` : ""}. ${error instanceof Error ? error.message : error}`,
      { cause: error },
    );
  }
}

async function expectEventually(message, assertion, timeout = 30_000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      await assertion();
      return;
    } catch (error) {
      lastError = error;
      await delay(250);
    }
  }
  throw new Error(`${message}: ${lastError instanceof Error ? lastError.message : lastError}`);
}

async function paymentRows(local, laptopId) {
  const url = new URL("/rest/v1/ba_dev_laptop_bid_payments", local.apiUrl);
  url.searchParams.set("laptop_id", `eq.${laptopId}`);
  url.searchParams.set("select", "id,bidder_name,status,logo_storage_path,stripe_checkout_session_id,stripe_payment_intent_id,application_fee_id,application_fee_refunded");
  url.searchParams.set("order", "created_at.asc");
  const response = await fetch(url, {
    headers: { apikey: local.secretKey, Authorization: `Bearer ${local.secretKey}` },
  });
  assert.equal(response.status, 200);
  return response.json();
}

async function cleanupFixture(local, container, fixture) {
  const fixtureSlug = fixture.slug;
  const rows = await paymentRows(local, fixture.laptopId);
  // Only this fixture's test payments/assets are in scope. Preserve its database
  // records if network cleanup fails so the exact leftovers can be reconciled.
  for (const row of rows) {
    if (!row.stripe_checkout_session_id) continue;
    const options = { stripeAccount: fixture.accountId };
    const session = await stripe.checkout.sessions.retrieve(row.stripe_checkout_session_id, {}, options);
    if (session.status === "open") await stripe.checkout.sessions.expire(session.id, {}, options);
    if (session.payment_status === "paid" && typeof session.payment_intent === "string") {
      const refunds = await stripe.refunds.list({ payment_intent: session.payment_intent, limit: 100 }, options);
      const refunded = refunds.data.filter((refund) => !["failed", "canceled"].includes(refund.status)).reduce((total, refund) => total + refund.amount, 0);
      if (refunded < session.amount_total) await stripe.refunds.create({
        payment_intent: session.payment_intent, amount: session.amount_total - refunded, refund_application_fee: true,
        metadata: { test_fixture: fixtureSlug },
      }, { ...options, idempotencyKey: `cleanup-${fixtureSlug}-${row.id}` });
      const confirmed = await stripe.refunds.list({ payment_intent: session.payment_intent, limit: 100 }, options);
      assert.equal(confirmed.data.filter((refund) => refund.status === "succeeded").reduce((sum, refund) => sum + refund.amount, 0), session.amount_total,
        "Preserve this fixture until all customer refunds have actually succeeded");
      const charge = confirmed.data[0].charge;
      const fees = await stripe.applicationFees.list({ charge: typeof charge === "string" ? charge : charge.id, limit: 2 });
      assert.equal(fees.data.length, 1, "Preserve the fixture until its application fee can be verified");
      const fee = fees.data[0];
      assert.equal(fee.account, fixture.accountId);
      if (!fee.refunded) await stripe.applicationFees.createRefund(fee.id, { metadata: { test_fixture: fixtureSlug } },
        { idempotencyKey: `cleanup-fee-${fixtureSlug}-${row.id}` });
      const confirmedFee = await stripe.applicationFees.retrieve(fee.id);
      assert.equal(confirmedFee.refunded, true); assert.equal(confirmedFee.amount_refunded, confirmedFee.amount);
    }
  }
  const paths = rows.map((row) => row.logo_storage_path).filter(Boolean);
  if (paths.length) {
    const client = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } });
    const { error } = await client.storage.from("ba_dev_bid_logos").remove(paths);
    assert.ifError(error);
  }
  removeFixture(container, fixtureSlug);
}

for (const { manualCustomerRefund, model } of [
  { manualCustomerRefund: false, model: false },
  { manualCustomerRefund: true, model: false },
  { manualCustomerRefund: false, model: true },
]) test(`${model ? "3D" : "homepage"} Stripe Bid → Outbid flow (${manualCustomerRefund ? "adopt manual customer refund" : "automatic full refund"})`, { timeout: 300_000 }, async () => {
  const fixtureSlug = `stripe-e2e-${randomUUID().slice(0, 8)}`;
  const local = localSupabaseEnvironment();
  // NEXT_PUBLIC_* values are frozen during build, not at next start.
  await buildLocalApp({ ...localAppEnvironment(local), STRIPE_SECRET_KEY: stripeKey });
  const container = databaseContainer();
  const fixture = createFixture(container, fixtureSlug, model);
  const port = await reservePort();
  const baseUrl = `http://127.0.0.1:${port}`;
  let listener;
  let app;
  let browser;

  try {
    const account = await stripe.accounts.retrieve(fixture.accountId);
    assert.equal(account.charges_enabled, true, "Connected account must accept test card charges.");

    app = await startApp(baseUrl, stripeWebhookSecret(), local, fixtureSlug);
    browser = await chromium.launch({ executablePath: chromePath, headless: true });
    const context = await browser.newContext({ locale: "en-US" });
    const page = await context.newPage();
    await page.goto(`${baseUrl}/${fixtureSlug}`, { waitUntil: "domcontentloaded" });
    const actionButton = page.locator(".spots-table .outbid-button");
    if (model) {
      await page.getByText("Drag to orbit · scroll to zoom", { exact: true }).waitFor();
      assert.equal(await page.locator("canvas").count(), 1);
      assert.equal(await page.locator(".mac-lid").count(), 0);
    }
    const bidButtonBackground = model ? null : await actionButton.evaluate((button) => getComputedStyle(button).backgroundColor);

    await placeBid(page, fixture.accountId, {
      amount: 400,
      brand: "Alpha Brand",
      email: "alpha-stripe-e2e@example.com",
      logo: {
        name: "alpha-brand.png",
        mimeType: "image/png",
        buffer: readFileSync(`${projectRoot}/public/logo-small.png`),
      },
    }, model);
    await page.locator(".payment-notice--accepted").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("session_id"), false);
    await expectEventually("first paid bid should render on spot 2", async () => {
      if (model) {
        assert.equal(await page.getByRole("button", { name: "Spot 2, held by Alpha Brand", exact: true }).count(), 1);
        assert.match(await page.locator('form:has(input[name="brandName"])').innerText(), /Alpha Brand.*\$400/);
        return;
      }
      const text = await page.locator(".lid-spot--2").innerText();
      assert.match(text, /Alpha Brand/);
      assert.match(text, /Outbid/);
      assert.match(text, /\$400/);
    });
    if (!model) await expectEventually("Outbid should use a distinct action color", async () => {
      assert.equal(await actionButton.textContent(), "Outbid");
      assert.equal(await actionButton.evaluate((button) => button.classList.contains("outbid-button--outbid")), true);
      assert.notEqual(
        await actionButton.evaluate((button) => getComputedStyle(button).backgroundColor),
        bidButtonBackground,
      );
    });
    await expectEventually("the winning logo should remain accessible after payment", async () => {
      if (model) {
        const snapshot = await (await page.request.get(`${baseUrl}/api/auctions/${fixtureSlug}`)).json();
        assert.ok(snapshot.spots[0].logo);
        assert.equal((await page.request.get(snapshot.spots[0].logo)).status(), 200);
        return;
      }
      const logo = page.locator('.lid-spot--2 img[alt="Alpha Brand"]');
      assert.equal(await logo.count(), 1);
      const state = await logo.evaluate((image) => ({
        complete: image.complete,
        currentSrc: image.currentSrc,
        naturalWidth: image.naturalWidth,
      }));
      const response = await page.request.get(state.currentSrc);
      assert.equal(response.status(), 200, `image optimizer returned ${response.status()} for ${state.currentSrc}`);
      assert.equal(state.complete && state.naturalWidth > 0, true, JSON.stringify(state));
    });

    const firstRows = await paymentRows(local, fixture.laptopId);
    assert.equal(firstRows.length, 1);
    assert.equal(firstRows[0].status, "accepted");
    const firstSession = await stripe.checkout.sessions.retrieve(
      firstRows[0].stripe_checkout_session_id,
      {},
      { stripeAccount: fixture.accountId },
    );
    assert.ok(firstSession.success_url.startsWith(`${baseUrl}/${fixtureSlug}?payment=success`));
    assert.equal(firstSession.amount_total, 8000, "A $400 bid collects only the $80 deposit");
    assert.match(firstSession.custom_text.submit.message, /remaining 80% is not collected automatically/);

    if (manualCustomerRefund) {
      // Simulate a seller refunding only the customer's deposit before the
      // outbid obligation is processed. Do not attach our application metadata.
      const manual = await stripe.refunds.create({ payment_intent: firstRows[0].stripe_payment_intent_id,
        refund_application_fee: false }, { stripeAccount: fixture.accountId });
      assert.equal(manual.status, "succeeded");
      const chargeId = typeof manual.charge === "string" ? manual.charge : manual.charge.id;
      await expectEventually("manual customer refund must leave the fee unrefunded for this regression", async () => {
        const fees = await stripe.applicationFees.list({ charge: chargeId, limit: 2 });
        assert.equal(fees.data.length, 1); assert.equal(fees.data[0].amount_refunded, 0);
      });
    }

    listener = startStripeListener(baseUrl);
    await waitForListener(listener);
    await placeBid(page, fixture.accountId, {
      amount: 410,
      brand: "Beta Brand",
      email: "beta-stripe-e2e@example.com",
    }, model);
    await expectEventually("outbid winner should replace the spot holder", async () => {
      if (model) {
        assert.equal(await page.getByRole("button", { name: "Spot 2, held by Beta Brand", exact: true }).count(), 1);
        assert.match(await page.locator('form:has(input[name="brandName"])').innerText(), /Beta Brand.*\$410/);
        return;
      }
      const text = await page.locator(".lid-spot--2").innerText();
      assert.match(text, /Beta Brand/);
      assert.match(text, /Outbid/);
      assert.match(text, /\$410/);
    });

    if (!model) await page.getByRole("tab", { name: /History \(2\)/ }).click();
    const history = await (model
      ? page.locator("section").filter({ has: page.getByRole("heading", { name: "Bid history", exact: true }) })
      : page.locator(".history-list")).innerText();
    assert.match(history, /Alpha Brand/);
    assert.match(history, /Beta Brand/);
    assert.match(history, /\$400/);
    assert.match(history, /\$410/);

    const rows = await paymentRows(local, fixture.laptopId);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((row) => row.status), ["refunded", "accepted"]);
    const refunds = await stripe.refunds.list(
      { payment_intent: rows[0].stripe_payment_intent_id, limit: 1 },
      { stripeAccount: fixture.accountId },
    );
    assert.equal(refunds.data[0]?.status, "succeeded");
    await expectEventually("the platform fee must also be fully refunded and verified in the database", async () => {
      const current = (await paymentRows(local, fixture.laptopId))[0];
      assert.equal(current.application_fee_refunded, true); assert.ok(current.application_fee_id);
      const fee = await stripe.applicationFees.retrieve(current.application_fee_id);
      assert.equal(fee.account, fixture.accountId); assert.equal(fee.refunded, true);
      assert.equal(fee.amount_refunded, fee.amount);
      assert.equal(fee.charge, typeof refunds.data[0].charge === "string" ? refunds.data[0].charge : refunds.data[0].charge.id);
    });
    const storage = createClient(local.apiUrl, local.secretKey, { auth: { persistSession: false } }).storage;
    const retainedLogo = await storage.from("ba_dev_bid_logos").download(rows[0].logo_storage_path);
    assert.ifError(retainedLogo.error);
    assert.ok(retainedLogo.data.size > 0, "Outbid must not delete an accepted bid's historical logo.");
    // The first bidder's real return link now reflects a verified refund, not
    // stale success. This exercises both public renderers without HTTP mocks.
    await page.goto(firstSession.success_url.replace("{CHECKOUT_SESSION_ID}", firstSession.id), { waitUntil: "domcontentloaded" });
    await page.locator(".payment-notice--refunded").waitFor();
    assert.equal(new URL(page.url()).searchParams.has("session_id"), false);
    if (model) {
      await page.getByText("Drag to orbit · scroll to zoom", { exact: true }).waitFor();
      assert.equal(await page.getByRole("button", { name: "Spot 2, held by Beta Brand", exact: true }).count(), 1);
      await page.screenshot({ path: "/tmp/stripe-3d-outbid-refunded.png" });
    } else assert.match(await page.locator(".lid-spot--2").innerText(), /Beta Brand/);
  } catch (error) {
    const diagnostics = [app?.logs(), listener?.logs()].filter(Boolean).join("\n\n");
    if (diagnostics) console.error(diagnostics);
    throw error;
  } finally {
    await browser?.close();
    await stopChild(app?.child);
    await stopChild(listener?.child);
    await cleanupFixture(local, container, fixture);
  }
});
