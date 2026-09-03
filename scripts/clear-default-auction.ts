import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const prefix = process.env.SUPABASE_DATABASE_PREFIX;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const dryRun = process.argv.includes("--dry-run");

if (!supabaseUrl || !supabaseKey) throw new Error("Local Supabase credentials are missing.");
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/i.test(supabaseUrl)) {
  throw new Error("The default-auction reset only runs against local Supabase.");
}
if (prefix !== "ba_dev") {
  throw new Error("The default-auction reset requires SUPABASE_DATABASE_PREFIX=ba_dev.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const laptopsTable = `${prefix}_laptops`;
const spotsTable = `${prefix}_laptop_spots`;
const bidsTable = `${prefix}_laptop_bids`;
const paymentsTable = `${prefix}_laptop_bid_payments`;
const logosBucket = `${prefix}_bid_logos`;

const { data: defaultAuctions, error: defaultError } = await supabase
  .from(laptopsTable)
  .select("id,slug,title,stripe_account_id")
  .eq("is_default", true);
if (defaultError) throw defaultError;
if (defaultAuctions.length !== 1) {
  throw new Error(`Expected exactly one ba_dev default auction, found ${defaultAuctions.length}.`);
}
const auction = defaultAuctions[0];

const [spotsResult, bidsResult, paymentsResult] = await Promise.all([
  supabase
    .from(spotsTable)
    .select("id,position,current_logo_storage_path")
    .eq("laptop_id", auction.id)
    .order("position"),
  supabase
    .from(bidsTable)
    .select("id,logo_storage_path,stripe_payment_intent_id")
    .eq("laptop_id", auction.id),
  supabase
    .from(paymentsTable)
    .select("id,status,logo_storage_path,stripe_checkout_session_id,stripe_payment_intent_id")
    .eq("laptop_id", auction.id),
]);
if (spotsResult.error) throw spotsResult.error;
if (bidsResult.error) throw bidsResult.error;
if (paymentsResult.error) throw paymentsResult.error;

const spots = spotsResult.data;
const bids = bidsResult.data;
const payments = paymentsResult.data;
const logoPaths = new Set<string>();
for (const row of [...spots, ...bids, ...payments]) {
  const path = "current_logo_storage_path" in row
    ? row.current_logo_storage_path
    : row.logo_storage_path;
  if (typeof path === "string" && path) logoPaths.add(path);
}

for (const spot of spots) {
  const folder = `laptops/${auction.slug}/${spot.position}`;
  const { data, error } = await supabase.storage.from(logosBucket).list(folder, { limit: 1000 });
  if (error) throw error;
  for (const object of data) {
    if (object.id) logoPaths.add(`${folder}/${object.name}`);
  }
}

const checkoutSessions = new Set(
  payments
    .map((payment) => payment.stripe_checkout_session_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0),
);
const paymentIntents = new Set(
  [...bids, ...payments]
    .map((row) => row.stripe_payment_intent_id)
    .filter((value): value is string => typeof value === "string" && value.length > 0),
);

console.log(`${dryRun ? "Dry run for" : "Resetting"} default auction /${auction.slug} (${auction.title})`);
console.log(`${spots.length} spots stay configured; ${bids.length} bids and ${payments.length} payment records will be cleared.`);
console.log(`${logoPaths.size} stored logos, ${checkoutSessions.size} Checkout Sessions, and ${paymentIntents.size} known PaymentIntents were found.`);
if (dryRun) {
  console.log("No Stripe, database, or Storage data was changed.");
  process.exit(0);
}

if ((checkoutSessions.size > 0 || paymentIntents.size > 0) && !auction.stripe_account_id) {
  throw new Error("The default auction has Stripe payments but no connected account id.");
}
if ((checkoutSessions.size > 0 || paymentIntents.size > 0)
  && (!stripeKey || !/^(?:rk|sk)_test_/.test(stripeKey))) {
  throw new Error("A Stripe test-mode key is required to clean Checkout and refund sandbox payments.");
}

if (stripeKey && auction.stripe_account_id) {
  const stripe = new Stripe(stripeKey);
  for (const sessionId of checkoutSessions) {
    const session = await stripe.checkout.sessions.retrieve(
      sessionId,
      { expand: ["payment_intent"] },
      { stripeAccount: auction.stripe_account_id },
    );
    if (session.status === "open") {
      await stripe.checkout.sessions.expire(
        session.id,
        {},
        { stripeAccount: auction.stripe_account_id },
      );
    }
    const intent = session.payment_intent;
    const intentId = typeof intent === "string" ? intent : intent?.id;
    if (intentId) paymentIntents.add(intentId);
  }

  for (const intentId of paymentIntents) {
    const intent = await stripe.paymentIntents.retrieve(
      intentId,
      { expand: ["latest_charge"] },
      { stripeAccount: auction.stripe_account_id },
    );
    const charge = typeof intent.latest_charge === "string"
      ? await stripe.charges.retrieve(intent.latest_charge, {}, { stripeAccount: auction.stripe_account_id })
      : intent.latest_charge;
    if (!charge || charge.amount_refunded >= charge.amount) continue;
    await stripe.refunds.create({
      payment_intent: intentId,
      amount: charge.amount - charge.amount_refunded,
      refund_application_fee: true,
      reason: "requested_by_customer",
      metadata: { brand_anything_reason: "local_default_reset" },
    }, {
      idempotencyKey: `ba-dev-default-reset-${charge.id}`,
      stripeAccount: auction.stripe_account_id,
    });
  }
}

const paths = [...logoPaths];
for (let offset = 0; offset < paths.length; offset += 100) {
  const { error } = await supabase.storage.from(logosBucket).remove(paths.slice(offset, offset + 100));
  if (error) throw error;
}

const { error: paymentsDeleteError } = await supabase
  .from(paymentsTable)
  .delete()
  .eq("laptop_id", auction.id);
if (paymentsDeleteError) throw paymentsDeleteError;

const { error: bidsDeleteError } = await supabase
  .from(bidsTable)
  .delete()
  .eq("laptop_id", auction.id);
if (bidsDeleteError) throw bidsDeleteError;

const { data: resetSpots, error: resetError } = await supabase
  .from(spotsTable)
  .update({
    current_bid_cents: null,
    current_bidder_name: null,
    current_logo_storage_path: null,
    current_website: null,
    bid_count: 0,
    updated_at: new Date().toISOString(),
  })
  .eq("laptop_id", auction.id)
  .select("id");
if (resetError) throw resetError;
if (resetSpots.length !== spots.length) {
  throw new Error(`Expected to reset ${spots.length} spots, reset ${resetSpots.length}.`);
}

const [remainingBids, remainingPayments] = await Promise.all([
  supabase.from(bidsTable).select("id", { count: "exact", head: true }).eq("laptop_id", auction.id),
  supabase.from(paymentsTable).select("id", { count: "exact", head: true }).eq("laptop_id", auction.id),
]);
if (remainingBids.error) throw remainingBids.error;
if (remainingPayments.error) throw remainingPayments.error;
if (remainingBids.count !== 0 || remainingPayments.count !== 0) {
  throw new Error("The default auction still contains bid or payment records after reset.");
}

console.log(`Default auction /${auction.slug} is empty and ready for new local bids.`);
