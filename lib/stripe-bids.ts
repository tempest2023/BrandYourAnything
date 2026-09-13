import "server-only";

import type Stripe from "stripe";
import type { ParsedBidForm } from "@/lib/bid-validation";
import { getLaptopSnapshot } from "@/lib/laptop-repository";
import {
  assertPaymentMatches, attachCheckoutSession, createOrGetBidPayment, expirePendingPayment,
  getBidPaymentById, getBidPaymentByIdempotencyKey, getBidPaymentBySessionId,
  getStripeAuctionBySlug, getStripeAuctionForPayment, getStripeBidContext,
  listRefundPendingPayments, markBidPaymentPaid, recordRefund, saveCheckoutParameters,
  settleLaptopBidPayment, stripeEnvironment, type LaptopBidPayment, type StripeBidContext,
  compensateLatePayment, deferPaymentReconciliation, listPaymentsToReconcile,
} from "@/lib/stripe-bid-repository";
import { getStripe, stripeIsLive } from "@/lib/stripe";
import { validateCheckoutIdentity, validatePaidCheckout } from "@/lib/stripe-payment-contract";

export type StripeBidErrorCode = "campaign_not_found" | "spot_not_found" | "auction_closed"
  | "payments_not_ready" | "bid_too_low" | "idempotency_conflict" | "checkout_unavailable";

export class StripeBidError extends Error {
  constructor(public code: StripeBidErrorCode, message: string) { super(message); this.name = "StripeBidError"; }
}

function contextError(error: unknown): never {
  if (error instanceof Error && error.message === "auction_closed") throw new StripeBidError("auction_closed", "This auction has already closed.");
  if (error instanceof Error && error.message === "payments_not_ready") throw new StripeBidError("payments_not_ready", "The seller has not finished setting up Stripe payouts for this auction.");
  if (error instanceof Error && error.message === "idempotency_conflict") throw new StripeBidError("idempotency_conflict", "This bid request was already used with different details.");
  throw error;
}

function checkoutParameters(payment: LaptopBidPayment, context: StripeBidContext, returnOrigin: string): Stripe.Checkout.SessionCreateParams {
  const returnUrl = new URL("/" + encodeURIComponent(context.slug), returnOrigin);
  const successUrl = new URL(returnUrl);
  successUrl.searchParams.set("payment", "success");
  successUrl.searchParams.set("session_id", "{CHECKOUT_SESSION_ID}");
  const cancelUrl = new URL(returnUrl);
  cancelUrl.searchParams.set("payment", "cancelled");
  const metadata = { bid_payment_id: payment.id, laptop_slug: context.slug, environment: stripeEnvironment() };
  return {
    mode: "payment", customer_email: payment.bidderEmail, payment_method_types: ["card"],
    // Stripe's default 24h lifetime keeps all parameters stable on retries.
    success_url: successUrl.toString().replace("%7BCHECKOUT_SESSION_ID%7D", "{CHECKOUT_SESSION_ID}"),
    cancel_url: cancelUrl.toString(),
    line_items: [{ quantity: 1, price_data: {
      currency: "usd", unit_amount: payment.depositAmountCents,
      product_data: { name: "20% bid deposit — spot " + payment.spotPosition,
        description: context.title + ": " + context.spotName + " · bid $" + (payment.bidAmountCents / 100).toFixed(2) },
    } }],
    metadata,
    payment_intent_data: { application_fee_amount: Math.min(payment.depositAmountCents, Math.round(payment.bidAmountCents * 0.1)), metadata },
    custom_text: { submit: { message: "This is a 20% bid deposit. It is refunded automatically if another bidder takes the lead or if your paid bid can no longer be accepted." } },
  };
}

export async function createLaptopBidCheckout(slug: string, input: ParsedBidForm, logoStoragePath: string | null, returnOrigin: string, ensureLogo?: () => Promise<void>) {
  let payment = await getBidPaymentByIdempotencyKey(input.idempotencyKey);
  const depositAmountCents = Math.max(50, Math.round(input.amountCents * 0.2));
  if (payment) {
    const auction = await getStripeAuctionForPayment(payment.laptopId);
    if (!auction || auction.slug !== slug.toLowerCase()) throw new StripeBidError("idempotency_conflict", "This request belongs to another auction.");
    try { assertPaymentMatches(payment, { laptopId: payment.laptopId, spotPosition: input.spotId,
      bidAmountCents: input.amountCents, depositAmountCents, bidderName: input.brandName, bidderEmail: input.email,
      website: input.website, xHandle: input.xHandle, logoStoragePath, idempotencyKey: input.idempotencyKey }); }
    catch (error) { contextError(error); }
    if (payment.checkoutSessionId && payment.stripeAccountId) {
      const session = await getStripe().checkout.sessions.retrieve(payment.checkoutSessionId, {}, { stripeAccount: payment.stripeAccountId });
      if (session.status === "complete") {
        // A lost HTTP response after payment is a confirmation retry, not a new charge.
        const url = new URL("/" + encodeURIComponent(auction.slug), returnOrigin);
        url.searchParams.set("payment", "success"); url.searchParams.set("session_id", session.id);
        return { checkoutUrl: url.toString(), sessionId: session.id, depositAmount: payment.depositAmountCents / 100 };
      }
      if (session.status !== "open" || !session.url) throw new StripeBidError("checkout_unavailable", "This checkout has expired. Start a new bid.");
    }
  }
  let context: StripeBidContext | null;
  try { context = await getStripeBidContext(slug, input.spotId); } catch (error) { contextError(error); }
  if (!context) throw new StripeBidError("campaign_not_found", "This auction or sticker spot does not exist.");
  if (input.amountCents < context.minimumBidCents) throw new StripeBidError("bid_too_low", "The new minimum bid is $" + (context.minimumBidCents / 100).toFixed(2) + ".");
  if (!payment) {
    try { payment = await createOrGetBidPayment({ laptopId: context.laptopId, spotPosition: input.spotId,
      bidAmountCents: input.amountCents, depositAmountCents, bidderName: input.brandName, bidderEmail: input.email,
      website: input.website, xHandle: input.xHandle, logoStoragePath, idempotencyKey: input.idempotencyKey,
      stripeAccountId: context.stripeAccountId }); }
    catch (error) { contextError(error); }
  }
  if (!payment.stripeAccountId || payment.stripeAccountId !== context.stripeAccountId) throw new StripeBidError("checkout_unavailable", "The seller account changed. Start a new bid.");
  if (payment.status !== "pending") throw new StripeBidError("checkout_unavailable", "This bid has already been processed.");
  // No upload happens until the durable reservation and request identity match.
  await ensureLogo?.();
  if (payment.checkoutSessionId) {
    const session = await getStripe().checkout.sessions.retrieve(payment.checkoutSessionId, {}, { stripeAccount: payment.stripeAccountId });
    if (!session.url || session.status !== "open") throw new StripeBidError("checkout_unavailable", "This checkout is no longer available.");
    return { checkoutUrl: session.url, sessionId: session.id, depositAmount: payment.depositAmountCents / 100 };
  }
  // Stripe may discard idempotency keys after 24h. Never recreate an ambiguous old operation.
  if (payment.checkoutRequestVersion !== 2 || Date.now() - Date.parse(payment.createdAt) >= 23 * 60 * 60 * 1000) throw new StripeBidError("checkout_unavailable", "This payment attempt needs reconciliation. Do not pay again until its status is confirmed.");
  const parameters = payment.checkoutParameters ?? await saveCheckoutParameters(payment.id, checkoutParameters(payment, context, returnOrigin));
  const session = await getStripe().checkout.sessions.create(parameters, {
    idempotencyKey: "ba-" + stripeEnvironment() + "-checkout-" + payment.id, stripeAccount: payment.stripeAccountId,
  });
  await attachCheckoutSession(payment.id, session.id);
  if (!session.url) throw new StripeBidError("checkout_unavailable", "Stripe did not return a Checkout URL.");
  return { checkoutUrl: session.url, sessionId: session.id, depositAmount: payment.depositAmountCents / 100 };
}

async function reconcileRefund(payment: LaptopBidPayment) {
  if (!payment.stripeAccountId || !payment.paymentIntentId) throw new Error("Refund work is missing its original payment identity.");
  const stripe = getStripe();
  const options = { stripeAccount: payment.stripeAccountId };
  let refund: Stripe.Refund | undefined;
  if (payment.refundId) refund = await stripe.refunds.retrieve(payment.refundId, {}, options);
  else {
    // Recover creates whose database write failed, even beyond the 24h key lifetime.
    const refunds = await stripe.refunds.list({ payment_intent: payment.paymentIntentId, limit: 100 }, options);
    refund = refunds.data.find((entry) => entry.amount === payment.depositAmountCents && entry.status !== "canceled" && entry.status !== "failed");
    if (!refund && refunds.data.length) throw new Error("This payment has other refunds; manual reconciliation is required.");
    refund ??= await stripe.refunds.create({ payment_intent: payment.paymentIntentId, amount: payment.depositAmountCents,
      refund_application_fee: true, reason: "requested_by_customer",
      metadata: { brand_anything_reason: payment.failureReason || "payment_rejected", bid_payment_id: payment.id },
    }, { ...options, idempotencyKey: "ba-" + stripeEnvironment() + "-refund-" + payment.id });
  }
  const intentId = typeof refund.payment_intent === "string" ? refund.payment_intent : refund.payment_intent?.id;
  if (intentId !== payment.paymentIntentId || refund.currency !== "usd" || refund.amount !== payment.depositAmountCents) throw new Error("Refund does not match the reserved deposit.");
  await recordRefund(payment.id, refund);
  if (refund.status === "failed" || refund.status === "canceled") throw new Error("Stripe refund failed; operator action is required.");
  return refund.status === "succeeded";
}

export async function reconcilePendingRefunds(laptopId?: string) {
  const payments = await listRefundPendingPayments(laptopId);
  let pending = 0;
  const failed: string[] = [];
  for (const payment of payments) {
    try { if (!await reconcileRefund(payment)) pending++; }
    catch (error) {
      failed.push(payment.id);
      console.error("Pending bid refund reconciliation failed", { paymentId: payment.id, error });
    }
  }
  return { processed: payments.length, pending, failed };
}

export type CheckoutFulfillment = {
  status: "pending" | "accepted" | "refund_pending" | "refunded" | "expired" | "failed";
  reason?: string; snapshot?: Awaited<ReturnType<typeof getLaptopSnapshot>>;
};

export async function fulfillCheckoutSession(sessionId: string, eventAccountId?: string, expectedSlug?: string, paymentIdHint?: string): Promise<CheckoutFulfillment> {
  let payment = await getBidPaymentBySessionId(sessionId);
  if (!payment && paymentIdHint) payment = await getBidPaymentById(paymentIdHint);
  if (!payment && expectedSlug) {
    const candidate = await getStripeAuctionBySlug(expectedSlug);
    if (candidate?.stripe_account_id) {
      const candidateSession = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] }, { stripeAccount: candidate.stripe_account_id });
      const id = candidateSession.metadata?.bid_payment_id;
      if (id && /^[0-9a-f-]{36}$/i.test(id)) payment = await getBidPaymentById(id);
    }
  }
  if (!payment) throw new StripeBidError("checkout_unavailable", "This Checkout Session is not a Brand Anything bid.");
  const auction = await getStripeAuctionForPayment(payment.laptopId);
  if (!auction || (expectedSlug && auction.slug !== expectedSlug) || !payment.stripeAccountId
    || (eventAccountId && eventAccountId !== payment.stripeAccountId)) throw new StripeBidError("checkout_unavailable", "This Checkout Session does not belong to this auction account.");
  // Always retrieve through the reserved account, never the seller's current one.
  const session = await getStripe().checkout.sessions.retrieve(sessionId, { expand: ["payment_intent"] }, { stripeAccount: payment.stripeAccountId });
  validateCheckoutIdentity(session, payment, auction.slug, stripeEnvironment(), stripeIsLive());
  const verifiedIntent = session.payment_status === "paid"
    ? validatePaidCheckout(session, { ...payment, checkoutSessionId: session.id }, auction.slug, stripeEnvironment(), stripeIsLive())
    : null;
  if (!payment.checkoutSessionId) payment = await attachCheckoutSession(payment.id, session.id);
  if (payment.checkoutSessionId !== session.id) throw new Error("Checkout attachment mismatch.");
  if (verifiedIntent) {
    if (payment.status === "pending" || payment.status === "paid") {
      payment = await markBidPaymentPaid(payment.id, session.id, verifiedIntent) ?? payment;
      if (payment.status === "paid") await settleLaptopBidPayment(payment.id);
    } else if (payment.status === "expired" || payment.status === "failed") await compensateLatePayment(payment.id, verifiedIntent);
  } else if (session.status === "expired") await expirePendingPayment(payment.id);

  const refunds = await reconcilePendingRefunds(payment.laptopId);
  // Webhooks retain Stripe retries on refund failures. Return-page confirmation
  // can still display a committed winning bid while durable work is outstanding.
  if (eventAccountId && refunds.failed.length) throw new Error("A queued refund needs retry.");
  const current = await getBidPaymentById(payment.id);
  if (!current) throw new Error("Payment disappeared during confirmation.");
  const status = current.status === "paid" ? "pending" : current.status;
  return { status, reason: current.failureReason ?? undefined,
    ...(["accepted", "refund_pending", "refunded"].includes(status) ? { snapshot: await getLaptopSnapshot(auction.slug) } : {}) };
}

export async function expireCheckoutSession(sessionId: string, eventAccountId?: string, paymentIdHint?: string) {
  // Verify the authoritative session; stale expiry cannot overwrite paid bids.
  return fulfillCheckoutSession(sessionId, eventAccountId, undefined, paymentIdHint);
}

export async function reconcileStripePayments() {
  const failed: string[] = [];
  const payments = await listPaymentsToReconcile();
  for (const payment of payments) {
    await deferPaymentReconciliation(payment.id);
    try {
      let sessionId = payment.checkoutSessionId;
      if (!sessionId && payment.stripeAccountId) {
        // Session creation may have succeeded before its response/attachment was
        // persisted. Search its account and creation window; never create again.
        let inspected = 0;
        for await (const session of getStripe().checkout.sessions.list({
          created: { gte: Math.floor(Date.parse(payment.createdAt) / 1000) - 300 }, limit: 100,
        }, { stripeAccount: payment.stripeAccountId })) {
          if (session.metadata?.bid_payment_id === payment.id) { sessionId = session.id; break; }
          if (++inspected >= 500) break;
        }
      }
      if (sessionId) await fulfillCheckoutSession(sessionId, payment.stripeAccountId ?? undefined, undefined, payment.id);
      else if (Date.now() - Date.parse(payment.createdAt) > 23 * 60 * 60 * 1000) {
        throw new Error("An old unbound Checkout attempt needs operator reconciliation.");
      }
    } catch (error) { failed.push(payment.id); console.error("Payment reconciliation failed", { paymentId: payment.id, error }); }
  }
  const refunds = await reconcilePendingRefunds();
  return { paymentsChecked: payments.length, refundsChecked: refunds.processed, refundsPending: refunds.pending, failed: [...new Set([...failed, ...refunds.failed])] };
}
