import { createClient } from "@supabase/supabase-js";
import Stripe from "stripe";

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const prefix = process.env.SUPABASE_DATABASE_PREFIX;
const stripeKey = process.env.STRIPE_SECRET_KEY;
const slug = process.argv.find((argument) => argument.startsWith("--slug="))?.slice("--slug=".length).trim().toLowerCase();
const suppliedAccount = process.argv.find((argument) => argument.startsWith("--account="))?.slice("--account=".length).trim()
  || process.env.STRIPE_SANDBOX_CONNECTED_ACCOUNT_ID?.trim();
const replaceExisting = process.argv.includes("--replace");

if (!supabaseUrl || !supabaseKey) throw new Error("Local Supabase credentials are missing.");
if (!/^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/.test(supabaseUrl)) {
  throw new Error("sandbox:attach-account refuses to modify a hosted Supabase project.");
}
if (prefix !== "ba_dev") throw new Error("sandbox:attach-account requires SUPABASE_DATABASE_PREFIX=ba_dev.");
if (!stripeKey || !/^(?:rk|sk)_test_/.test(stripeKey)) {
  throw new Error("sandbox:attach-account requires a Stripe test-mode key.");
}
if (!slug || !/^[a-z0-9](?:[a-z0-9-]{1,46}[a-z0-9])$/.test(slug)) {
  throw new Error("Pass the local auction address as --slug=your-auction.");
}

const supabase = createClient(supabaseUrl, supabaseKey, {
  auth: { autoRefreshToken: false, persistSession: false },
});
const table = `${prefix}_laptops`;
const { data: target, error: targetError } = await supabase
  .from(table)
  .select("id,slug,title,stripe_account_id")
  .eq("slug", slug)
  .maybeSingle();
if (targetError) throw targetError;
if (!target) throw new Error(`Auction /${slug} does not exist in ba_dev.`);

let accountId = suppliedAccount;
if (!accountId) {
  const { data: homepage, error: homepageError } = await supabase
    .from(table)
    .select("stripe_account_id")
    .eq("is_default", true)
    .single();
  if (homepageError) throw homepageError;
  accountId = homepage.stripe_account_id;
}
if (!accountId || !/^acct_[A-Za-z0-9]+$/.test(accountId)) {
  throw new Error("No sandbox connected account was supplied or attached to the homepage auction.");
}
if (target.stripe_account_id && target.stripe_account_id !== accountId && !replaceExisting) {
  throw new Error("This auction already uses another Stripe account. Pass --replace only when that is intentional.");
}

const stripe = new Stripe(stripeKey);
const account = await stripe.v2.core.accounts.retrieve(accountId, {
  include: ["configuration.merchant", "requirements"],
});
const chargesEnabled = account.configuration?.merchant?.capabilities?.card_payments?.status === "active";
const payoutsStatus = account.configuration?.merchant?.capabilities?.stripe_balance?.payouts?.status;
const payoutsEnabled = payoutsStatus === undefined ? chargesEnabled : payoutsStatus === "active";
if (!chargesEnabled || !payoutsEnabled) {
  throw new Error("The selected sandbox connected account is not ready for card payments and payouts.");
}

const { error: updateError } = await supabase
  .from(table)
  .update({
    stripe_account_id: accountId,
    stripe_charges_enabled: true,
    stripe_payouts_enabled: true,
    updated_at: new Date().toISOString(),
  })
  .eq("id", target.id);
if (updateError) throw updateError;

console.log(`Attached the active sandbox account to /${target.slug}.`);
console.log(`Open http://localhost:3000/${target.slug} to test Stripe-hosted bids.`);
