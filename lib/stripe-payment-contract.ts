import type Stripe from "stripe";

export type PaymentContract = {
  id: string; checkoutSessionId: string | null; paymentIntentId: string | null;
  depositAmountCents: number; bidAmountCents: number;
};

export function validatePaidCheckout(
  session: Stripe.Checkout.Session, payment: PaymentContract,
  auctionSlug: string, environment: string,
) {
  validateCheckoutIdentity(session, payment, auctionSlug, environment);
  const intent = session.payment_intent;
  if (session.id !== payment.checkoutSessionId || session.mode !== "payment"
    || session.status !== "complete" || session.payment_status !== "paid"
    || session.currency !== "usd"
    || session.amount_total !== payment.depositAmountCents
    || session.metadata?.bid_payment_id !== payment.id
    || session.metadata?.laptop_slug !== auctionSlug || session.metadata?.environment !== environment
    || !intent || typeof intent === "string" || intent.status !== "succeeded"
    || intent.currency !== "usd" || intent.amount !== payment.depositAmountCents
    || intent.amount_received !== payment.depositAmountCents
    || intent.metadata?.bid_payment_id !== payment.id || intent.metadata?.laptop_slug !== auctionSlug
    || (intent.metadata?.environment !== undefined && intent.metadata.environment !== environment)
    || (payment.paymentIntentId !== null && intent.id !== payment.paymentIntentId)
    || intent.application_fee_amount !== Math.min(payment.depositAmountCents, Math.round(payment.bidAmountCents * 0.1))) {
    throw new Error("Stripe payment does not match its reserved bid.");
  }
  return intent.id;
}

// The Stripe mode (test/live) belongs to the *deployment*, so a production
// deployment may legitimately settle a sandbox session. What must match is the
// reserved account, the auction, the deposit and the environment namespace.
export function validateCheckoutIdentity(session: Stripe.Checkout.Session, payment: PaymentContract, auctionSlug: string, environment: string) {
  if ((payment.checkoutSessionId !== null && session.id !== payment.checkoutSessionId)
    || session.mode !== "payment" || session.currency !== "usd"
    || session.amount_total !== payment.depositAmountCents || session.metadata?.bid_payment_id !== payment.id
    || session.metadata?.laptop_slug !== auctionSlug || session.metadata?.environment !== environment) {
    throw new Error("Checkout identity or environment mismatch.");
  }
}
