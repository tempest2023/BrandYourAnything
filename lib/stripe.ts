import "server-only";

import Stripe from "stripe";

import { SITE_URL } from "@/lib/site";
import { resolveStripeMode } from "@/lib/environment-policy";

let stripeClient: Stripe | null = null;
let stripeClientKey: string | undefined;

export function isStripeConfigured() {
  try { resolveStripeMode(process.env); return true; } catch { return false; }
}

export function stripeIsLive() { return resolveStripeMode(process.env) === "live"; }

export function getStripe() {
  resolveStripeMode(process.env);
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  if (!stripeClient || stripeClientKey !== secretKey) stripeClient = new Stripe(secretKey, {
    timeout: 15_000,
    maxNetworkRetries: 2,
    appInfo: {
      name: "Brand Anything",
      version: "1.0.0",
      url: SITE_URL,
    },
  });
  stripeClientKey = secretKey;
  return stripeClient;
}

export function getStripeWebhookSecrets() {
  const platformSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
  if (!platformSecret && !connectSecret) throw new Error("A Stripe webhook signing secret is required.");
  return [...new Set([platformSecret, connectSecret].filter((secret): secret is string => Boolean(secret)))];
}

export async function getStripeMerchantAccountState(accountId: string) {
  const account = await getStripe().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "requirements"],
  });
  return mapStripeMerchantAccountState(account);
}

export function mapStripeMerchantAccountState(account: Stripe.V2.Core.Account) {
  const capabilities = account.configuration?.merchant?.capabilities;
  const chargesEnabled = capabilities?.card_payments?.status === "active";
  const payoutsStatus = capabilities?.stripe_balance?.payouts?.status;
  return {
    id: account.id,
    closed: account.closed === true,
    chargesEnabled,
    // Accepting cards does not prove that the merchant can receive payouts.
    // Missing capability data is unknown, never permission to accept bids.
    payoutsEnabled: payoutsStatus === "active",
    detailsSubmitted: chargesEnabled,
  };
}
