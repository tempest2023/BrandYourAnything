import assert from "node:assert/strict";

import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const prefix = process.env.SUPABASE_DATABASE_PREFIX;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const appUrl = (process.env.NEXT_PUBLIC_SITE_URL || "http://localhost:3000").replace(/\/$/, "");

if (!supabaseUrl || !supabaseKey) throw new Error("Local Supabase credentials are missing.");
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(supabaseUrl)) {
  throw new Error("sandbox:check only runs against local Supabase.");
}
if (prefix !== "ba_dev") throw new Error("sandbox:check requires SUPABASE_DATABASE_PREFIX=ba_dev.");
if (!stripeKey || !/^(?:rk|sk)_test_/.test(stripeKey)) {
  throw new Error("sandbox:check requires a Stripe test-mode key.");
}
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(appUrl)) {
  throw new Error("NEXT_PUBLIC_SITE_URL must target the local app.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const laptopsTable = `${prefix}_laptops`;
const spotsTable = `${prefix}_laptop_spots`;

const { data: defaults, error: defaultError } = await supabase
  .from(laptopsTable)
  .select("id,slug,title,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled")
  .eq("is_default", true);
if (defaultError) throw defaultError;
assert.equal(defaults.length, 1, "ba_dev must contain exactly one homepage auction");
const homepage = defaults[0];

const { count: spotCount, error: spotError } = await supabase
  .from(spotsTable)
  .select("id", { count: "exact", head: true })
  .eq("laptop_id", homepage.id);
if (spotError) throw spotError;
assert.equal(spotCount, 10, "the homepage auction must contain ten spots");

const { data: modelBucket, error: bucketError } = await supabase.storage
  .getBucket(`${prefix}_brand_models`);
if (bucketError) throw bucketError;
assert.ok(
  Number(modelBucket.file_size_limit) >= 25 * 1024 * 1024,
  "the local model bucket must accept 25 MB uploads",
);

assert.ok(homepage.stripe_account_id, "the homepage auction needs a sandbox connected account");
const stripe = new Stripe(stripeKey);
const account = await stripe.v2.core.accounts.retrieve(homepage.stripe_account_id, {
  include: ["configuration.merchant", "requirements"],
});
const cardPayments = account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
const payoutsStatus = account.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status;
const payouts = payoutsStatus === undefined ? cardPayments : payoutsStatus === "active";
assert.ok(cardPayments && payouts, "the connected account must be ready for card payments and payouts");
assert.ok(homepage.stripe_charges_enabled && homepage.stripe_payouts_enabled, "Supabase payment flags are stale");

const [homeResponse, apiResponse] = await Promise.all([
  fetch(`${appUrl}/`),
  fetch(`${appUrl}/api/laptops/${encodeURIComponent(homepage.slug)}`),
]);
assert.equal(homeResponse.status, 200, "the local homepage must respond with HTTP 200");
assert.equal(apiResponse.status, 200, "the homepage auction API must respond with HTTP 200");
const homeHtml = await homeResponse.text();
assert.match(homeHtml, /class="apple-mark"[^>]*><\/span>/, "the default Mac auction must render its center Apple mark");
const snapshot = await apiResponse.json();
assert.equal(snapshot.campaign?.paymentsEnabled, true, "the homepage Bid button must have payments enabled");
assert.equal(snapshot.spots?.length, 10, "the homepage API must expose ten spots");
assert.ok(
  snapshot.spots.every((spot) => spot.id >= 1 && spot.id <= 10 && !/over the logo|cover(?:ing)? the (?:apple )?(?:mark|logo)/i.test(spot.name)),
  "the default auction must not sell a spot over the Mac logo",
);

if (process.env.NEXT_PUBLIC_X_AUTH_DEV_MOCK === "1") {
  const mockResponse = await fetch(`${appUrl}/api/dev/x-auth`, { method: "POST" });
  const mockPayload = await mockResponse.json();
  assert.equal(mockResponse.status, 200, mockPayload.error || "the local X mock must return a session");
  assert.equal(mockPayload.mock, true, "the local X endpoint must identify its response as mocked");
  assert.match(mockPayload.session?.accessToken || "", /^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/, "the mock must return a Supabase access token");
  assert.ok(mockPayload.session?.refreshToken, "the mock must return a refresh token for browser persistence");
  const mineResponse = await fetch(`${appUrl}/api/laptops/mine`, {
    headers: { Authorization: `Bearer ${mockPayload.session.accessToken}` },
  });
  const minePayload = await mineResponse.json();
  assert.equal(mineResponse.status, 200, minePayload.error || "the mock X session must authorize ownership APIs");
}

const { data: auctions, error: auctionsError } = await supabase
  .from(laptopsTable)
  .select("slug,stripe_charges_enabled,stripe_payouts_enabled");
if (auctionsError) throw auctionsError;
const readyAuctions = auctions.filter((auction) => (
  auction.stripe_charges_enabled && auction.stripe_payouts_enabled
));

console.log("Stripe sandbox health check passed.");
console.log(`Homepage: ${appUrl}/ (${homepage.slug}, ${spotCount} spots, Checkout ready)`);
console.log(`Auctions in ba_dev: ${auctions.length}; payment-ready: ${readyAuctions.length}`);
if (process.env.NEXT_PUBLIC_X_AUTH_DEV_MOCK === "1") {
  console.log("Local X sign-in mock: ready (real local Supabase session, no X request)");
}
console.log("Webhook forwarding and the local Next.js server are reachable.");
