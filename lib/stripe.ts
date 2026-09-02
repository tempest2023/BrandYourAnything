import "server-only";

import Stripe from "stripe";

import { SITE_URL } from "@/lib/site";

let stripeClient: Stripe | null = null;

export function isStripeConfigured() {
  return Boolean(process.env.STRIPE_SECRET_KEY?.trim());
}

export function getStripe() {
  const secretKey = process.env.STRIPE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("STRIPE_SECRET_KEY is not configured.");
  }
  stripeClient ??= new Stripe(secretKey, {
    appInfo: {
      name: "Brand Anything",
      version: "1.0.0",
      url: SITE_URL,
    },
  });
  return stripeClient;
}

export function getStripeWebhookSecrets() {
  const platformSecret = process.env.STRIPE_WEBHOOK_SECRET?.trim();
  const connectSecret = process.env.STRIPE_CONNECT_WEBHOOK_SECRET?.trim();
  if (!platformSecret) throw new Error("STRIPE_WEBHOOK_SECRET is not configured.");
  return [...new Set([platformSecret, connectSecret].filter((secret): secret is string => Boolean(secret)))];
}

export async function getStripeMerchantAccountState(accountId: string) {
  const account = await getStripe().v2.core.accounts.retrieve(accountId, {
    include: ["configuration.merchant", "requirements"],
  });
  const capabilities = account.configuration?.merchant?.capabilities;
  const chargesEnabled = capabilities?.card_payments?.status === "active";
  const payoutsStatus = capabilities?.stripe_balance?.payouts?.status;
  return {
    id: account.id,
    closed: account.closed === true,
    chargesEnabled,
    payoutsEnabled: payoutsStatus === undefined ? chargesEnabled : payoutsStatus === "active",
    detailsSubmitted: chargesEnabled,
  };
}
