import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const prefix = process.env.SUPABASE_DATABASE_PREFIX;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const appUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

if (!supabaseUrl || !supabaseKey) throw new Error("Local Supabase credentials are missing.");
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(supabaseUrl)) {
  throw new Error("The sandbox Checkout test only runs against local Supabase.");
}
if (prefix !== "ba_dev") throw new Error("The sandbox Checkout test requires ba_dev.");
if (!stripeKey || !/^(?:rk|sk)_test_/.test(stripeKey)) {
  throw new Error("The sandbox Checkout test requires a Stripe test-mode key.");
}
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(appUrl)) {
  throw new Error("NEXT_PUBLIC_SITE_URL must target the local app.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const stripe = new Stripe(stripeKey);
const laptopsTable = `${prefix}_laptops`;
const spotsTable = `${prefix}_laptop_spots`;
const paymentsTable = `${prefix}_laptop_bid_payments`;
const createFunction = `${prefix}_create_owned_laptop`;
const placeBidFunction = `${prefix}_place_laptop_bid`;
const logoBucket = `${prefix}_bid_logos`;
const testId = randomUUID().slice(0, 8);
const secondSlug = `sandbox-hosted-${testId}`;
const paymentKeys = [];
let uploadedLogoPath = null;

async function campaign(slug) {
  const { data, error } = await supabase
    .from(laptopsTable)
    .select("id,slug,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled")
    .eq("slug", slug)
    .single();
  if (error) throw error;
  return data;
}

async function minimumBid(laptopId, position) {
  const { data, error } = await supabase
    .from(spotsTable)
    .select("opening_bid_cents,min_increment_cents,current_bid_cents")
    .eq("laptop_id", laptopId)
    .eq("position", position)
    .single();
  if (error) throw error;
  return data.current_bid_cents === null
    ? Number(data.opening_bid_cents)
    : Number(data.current_bid_cents) + Number(data.min_increment_cents);
}

async function verifyHostedCheckout(slug, position, brandName) {
  const ownerCampaign = await campaign(slug);
  assert.ok(ownerCampaign.stripe_account_id, `${slug} needs a connected account`);
  assert.ok(ownerCampaign.stripe_charges_enabled && ownerCampaign.stripe_payouts_enabled, `${slug} payments must be ready`);
  const amountCents = await minimumBid(ownerCampaign.id, position);
  const idempotencyKey = randomUUID();
  paymentKeys.push(idempotencyKey);
  const form = new FormData();
  form.set("spotId", String(position));
  form.set("amountCents", String(amountCents));
  form.set("brandName", brandName);
  form.set("email", `${testId}@example.com`);
  form.set("idempotencyKey", idempotencyKey);

  const response = await fetch(`${appUrl}/api/laptops/${encodeURIComponent(slug)}/bids`, {
    method: "POST",
    body: form,
  });
  const body = await response.json();
  assert.equal(response.status, 201, body.error || `Checkout did not start for ${slug}`);
  assert.match(body.checkoutUrl, /^https:\/\/checkout\.stripe\.com\//, "Stripe-hosted Checkout URL is required");
  assert.match(body.sessionId, /^cs_test_/, "a test Checkout Session is required");

  const session = await stripe.checkout.sessions.retrieve(
    body.sessionId,
    {},
    { stripeAccount: ownerCampaign.stripe_account_id },
  );
  assert.equal(session.livemode, false, "Checkout must remain in Stripe test mode");
  assert.equal(session.status, "open", "Checkout must be open before the simulated cancellation");
  assert.equal(session.amount_total, Math.max(50, Math.round(amountCents * 0.2)), "Checkout must collect a 20% deposit");
  assert.equal(session.metadata?.laptop_slug, slug, "Checkout metadata must identify the auction");

  await stripe.checkout.sessions.expire(
    body.sessionId,
    {},
    { stripeAccount: ownerCampaign.stripe_account_id },
  );
  const fulfillment = await fetch(`${appUrl}/api/stripe/checkout/${encodeURIComponent(body.sessionId)}`);
  const fulfillmentBody = await fulfillment.json();
  assert.equal(fulfillment.status, 200, fulfillmentBody.error || "Expired Checkout settlement failed");
  assert.equal(fulfillmentBody.status, "expired", "an abandoned hosted Checkout must expire without a bid");
  return { laptopId: ownerCampaign.id, sessionId: body.sessionId };
}

let secondLaptopId = null;
try {
  const { data: homepage, error: homepageError } = await supabase
    .from(laptopsTable)
    .select("id,slug")
    .eq("is_default", true)
    .single();
  if (homepageError) throw homepageError;
  const homepageCheckout = await verifyHostedCheckout(homepage.slug, 1, `Homepage ${testId}`);

  const managerHash = createHash("sha256").update(`sandbox-manager-${randomUUID()}`).digest("hex");
  const { data: creation, error: creationError } = await supabase.rpc(createFunction, {
    p_slug: secondSlug,
    p_owner_user_id: null,
    p_manager_key_hash: managerHash,
    p_owner_name: "Sandbox Creator",
    p_owner_email: `${testId}@example.com`,
    p_title: `Second sandbox auction ${testId}`,
    p_tagline: "A temporary hosted Checkout test.",
    p_story: "This local fixture is removed after the test.",
    p_laptop_model: "MacBook Pro 14-inch",
    p_goal_cents: 320000,
    p_auction_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_photo_storage_path: null,
    p_small_opening_bid_cents: 12500,
    p_medium_opening_bid_cents: 20000,
    p_large_opening_bid_cents: 40000,
    p_min_increment_cents: 1000,
    p_idempotency_key: randomUUID(),
  });
  if (creationError) throw creationError;
  secondLaptopId = creation[0].laptop_id;

  const attached = spawnSync(process.execPath, [
    "--env-file=.env.local",
    "scripts/attach-sandbox-account.mjs",
    `--slug=${secondSlug}`,
  ], { encoding: "utf8" });
  if (attached.status !== 0) throw new Error(attached.stderr || attached.stdout || "Sandbox account attachment failed.");

  const secondCheckout = await verifyHostedCheckout(secondSlug, 1, `Second ${testId}`);
  assert.notEqual(homepageCheckout.laptopId, secondCheckout.laptopId, "the two hosted bids must belong to different auctions");
  assert.notEqual(homepageCheckout.sessionId, secondCheckout.sessionId, "the two hosted bids need separate Checkout Sessions");

  uploadedLogoPath = `laptops/${secondSlug}/1/render-${testId}.png`;
  const onePixelPng = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64",
  );
  const { error: uploadError } = await supabase.storage.from(logoBucket).upload(
    uploadedLogoPath,
    onePixelPng,
    { contentType: "image/png", upsert: false },
  );
  if (uploadError) throw uploadError;
  const logoBidAmount = await minimumBid(secondLaptopId, 1);
  const { data: logoBid, error: logoBidError } = await supabase.rpc(placeBidFunction, {
    p_laptop_slug: secondSlug,
    p_spot_position: 1,
    p_amount_cents: logoBidAmount,
    p_bidder_name: `Logo render ${testId}`,
    p_bidder_email: `${testId}@example.com`,
    p_website: null,
    p_x_handle: null,
    p_logo_storage_path: uploadedLogoPath,
    p_idempotency_key: randomUUID(),
  });
  if (logoBidError) throw logoBidError;
  assert.equal(logoBid[0]?.accepted, true, "the render fixture bid must be accepted");

  const [publicPage, snapshotResponse] = await Promise.all([
    fetch(`${appUrl}/${secondSlug}`),
    fetch(`${appUrl}/api/laptops/${secondSlug}`),
  ]);
  assert.equal(publicPage.status, 200, "the paid-bid page must render with a signed Supabase logo URL");
  assert.equal(snapshotResponse.status, 200, "the logo fixture snapshot must load");
  const snapshot = await snapshotResponse.json();
  const signedLogoUrl = snapshot.spots?.find((spot) => spot.id === 1)?.logo;
  assert.match(signedLogoUrl, /^http:\/\/127\.0\.0\.1:54321\/storage\/v1\/object\/sign\//, "the local logo must use a signed Storage URL");
  const optimizedLogo = await fetch(
    `${appUrl}/_next/image?url=${encodeURIComponent(signedLogoUrl)}&w=256&q=75`,
  );
  assert.equal(optimizedLogo.status, 200, "Next Image must allow the configured local Supabase signed-image origin");
  assert.match(optimizedLogo.headers.get("content-type") || "", /^image\//, "the image optimizer must return an image");

  const { data: payments, error: paymentError } = await supabase
    .from(paymentsTable)
    .select("laptop_id,status")
    .in("idempotency_key", paymentKeys);
  if (paymentError) throw paymentError;
  assert.equal(payments.length, 2, "both auctions must have an isolated payment record");
  assert.ok(payments.every((payment) => payment.status === "expired"), "the smoke test must not leave payable sessions open");

  console.log("Stripe-hosted Checkout smoke test passed for the homepage and a second isolated auction.");
  console.log("Both test Checkout Sessions were expired without charging a card.");
} finally {
  if (paymentKeys.length > 0) {
    const { error } = await supabase.from(paymentsTable).delete().in("idempotency_key", paymentKeys);
    if (error) console.error("Could not remove sandbox payment fixtures", error.message);
  }
  if (secondLaptopId) {
    const { error } = await supabase.from(laptopsTable).delete().eq("id", secondLaptopId);
    if (error) console.error("Could not remove the second sandbox auction fixture", error.message);
  }
  if (uploadedLogoPath) {
    const { error } = await supabase.storage.from(logoBucket).remove([uploadedLogoPath]);
    if (error) console.error("Could not remove the sandbox logo fixture", error.message);
  }
}
