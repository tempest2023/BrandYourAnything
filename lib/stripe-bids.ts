import "server-only";

import Stripe from "stripe";

import type { ParsedBidForm } from "@/lib/bid-validation";
import { getLaptopBidPaymentTable, getLogoBucket } from "@/lib/database-names";
import { getLaptopSnapshot } from "@/lib/laptop-repository";
import { SITE_URL } from "@/lib/site";
import {
  attachCheckoutSession,
  createOrGetBidPayment,
  getBidPaymentBySessionId,
  getStripeAccountIdForLaptop,
  getStripeBidContext,
  markBidPaymentPaid,
  markBidPaymentStatus,
  markPaymentIntentRefunded,
  settleLaptopBidPayment,
  stripeEnvironment,
  type LaptopBidPayment,
} from "@/lib/stripe-bid-repository";
import { getStripe } from "@/lib/stripe";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

const DEPOSIT_RATE = 0.2;
const PLATFORM_FEE_RATE = 0.1;

export type StripeBidErrorCode =
  | "campaign_not_found"
  | "spot_not_found"
  | "auction_closed"
  | "payments_not_ready"
  | "bid_too_low"
  | "idempotency_conflict"
  | "checkout_unavailable";

export class StripeBidError extends Error {
  code: StripeBidErrorCode;

  constructor(code: StripeBidErrorCode, message: string) {
    super(message);
    this.name = "StripeBidError";
    this.code = code;
  }
}

function paymentIntentId(value: string | Stripe.PaymentIntent | null) {
  return typeof value === "string" ? value : value?.id ?? null;
}

async function removeLogo(path: string | null) {
  if (!path) return;
  const { error } = await getSupabaseAdmin().storage.from(getLogoBucket()).remove([path]);
  if (error) console.error("Failed to clean up Stripe bid logo", { path, message: error.message });
}

function translateContextError(error: unknown): never {
  if (!(error instanceof Error)) throw error;
  if (error.message === "auction_closed") {
    throw new StripeBidError("auction_closed", "This auction has already closed.");
  }
  if (error.message === "payments_not_ready") {
    throw new StripeBidError(
      "payments_not_ready",
      "The seller has not finished setting up Stripe payouts for this auction.",
    );
  }
  throw error;
}

export async function createLaptopBidCheckout(
  slug: string,
  input: ParsedBidForm,
  logoStoragePath: string | null,
) {
  let context;
  try {
    context = await getStripeBidContext(slug, input.spotId);
  } catch (error) {
    translateContextError(error);
  }
  if (!context) {
    throw new StripeBidError("campaign_not_found", "This auction or sticker spot does not exist.");
  }
  if (input.amountCents < context.minimumBidCents) {
    throw new StripeBidError(
      "bid_too_low",
      `Another bidder moved first. The new minimum is $${(context.minimumBidCents / 100).toLocaleString("en-US")}.`,
    );
  }

  const depositAmountCents = Math.max(50, Math.round(input.amountCents * DEPOSIT_RATE));
  const platformFeeAmountCents = Math.min(
    depositAmountCents,
    Math.round(input.amountCents * PLATFORM_FEE_RATE),
  );
  let payment: LaptopBidPayment;
  try {
    payment = await createOrGetBidPayment({
      laptopId: context.laptopId,
      spotPosition: input.spotId,
      bidAmountCents: input.amountCents,
      depositAmountCents,
      bidderName: input.brandName,
      bidderEmail: input.email,
      website: input.website,
      xHandle: input.xHandle,
      logoStoragePath,
      idempotencyKey: input.idempotencyKey,
    });
  } catch (error) {
    if (error instanceof Error && error.message === "idempotency_conflict") {
      throw new StripeBidError(
        "idempotency_conflict",
        "This bid request was already used with different details. Please submit it again.",
      );
    }
    throw error;
  }

  const stripe = getStripe();
  if (payment.checkoutSessionId) {
    const existingSession = await stripe.checkout.sessions.retrieve(
      payment.checkoutSessionId,
      {},
      { stripeAccount: context.stripeAccountId },
    );
    if (existingSession.url && existingSession.status === "open") {
      return {
        checkoutUrl: existingSession.url,
        sessionId: existingSession.id,
        depositAmount: depositAmountCents / 100,
      };
    }
    throw new StripeBidError(
      "checkout_unavailable",
      "This checkout is no longer available. Start a new bid to continue.",
    );
  }

  const successUrl = `${SITE_URL}/${context.slug}?payment=success&session_id={CHECKOUT_SESSION_ID}`;
  const cancelUrl = new URL(`/${encodeURIComponent(context.slug)}`, SITE_URL);
  cancelUrl.searchParams.set("payment", "cancelled");

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    customer_email: input.email,
    payment_method_types: ["card"],
    expires_at: Math.floor(Date.now() / 1000) + 30 * 60,
    success_url: successUrl,
    cancel_url: cancelUrl.toString(),
    line_items: [{
      quantity: 1,
      price_data: {
        currency: "usd",
        unit_amount: depositAmountCents,
        product_data: {
          name: `20% bid deposit — spot ${context.spotPosition}`,
          description: `${context.title}: ${context.spotName} · bid $${(input.amountCents / 100).toLocaleString("en-US")}`,
        },
      },
    }],
    metadata: {
      bid_payment_id: payment.id,
      laptop_slug: context.slug,
      environment: stripeEnvironment(),
    },
    payment_intent_data: {
      application_fee_amount: platformFeeAmountCents,
      metadata: {
        bid_payment_id: payment.id,
        laptop_slug: context.slug,
      },
    },
    custom_text: {
      submit: {
        message: "This is a 20% bid deposit. It is refunded automatically if another bidder takes the lead or if your paid bid can no longer be accepted.",
      },
    },
  }, {
    idempotencyKey: `ba-${stripeEnvironment()}-checkout-${input.idempotencyKey}`,
    stripeAccount: context.stripeAccountId,
  });

  if (!session.url) {
    throw new StripeBidError("checkout_unavailable", "Stripe did not return a Checkout URL.");
  }
  await attachCheckoutSession(payment.id, session.id);
  return {
    checkoutUrl: session.url,
    sessionId: session.id,
    depositAmount: depositAmountCents / 100,
  };
}

async function refundPaymentIntent(
  paymentIntent: string,
  paymentId: string,
  stripeAccountId: string,
  reason: "outbid" | "auction_closed" | "bid_too_low" | "payment_rejected",
) {
  await markBidPaymentStatus(paymentId, "refund_pending", reason);
  await getStripe().refunds.create({
    payment_intent: paymentIntent,
    refund_application_fee: true,
    reason: "requested_by_customer",
    metadata: { brand_anything_reason: reason, bid_payment_id: paymentId },
  }, {
    idempotencyKey: `ba-${stripeEnvironment()}-refund-${reason}-${paymentIntent}`,
    stripeAccount: stripeAccountId,
  });
  await markBidPaymentStatus(paymentId, "refunded", reason);
}

export type CheckoutFulfillment = {
  status: "pending" | "accepted" | "refunded" | "expired" | "failed";
  reason?: string;
  snapshot?: Awaited<ReturnType<typeof getLaptopSnapshot>>;
};

export async function fulfillCheckoutSession(
  sessionId: string,
  eventAccountId?: string,
): Promise<CheckoutFulfillment> {
  const stripe = getStripe();
  const payment = await getBidPaymentBySessionId(sessionId);
  if (!payment) {
    throw new StripeBidError("checkout_unavailable", "This Checkout Session is not a Brand Anything bid.");
  }
  const stripeAccountId = await getStripeAccountIdForLaptop(payment.laptopId);
  if (!stripeAccountId || (eventAccountId && eventAccountId !== stripeAccountId)) {
    throw new StripeBidError("checkout_unavailable", "This Checkout Session is not attached to the auction seller.");
  }
  const session = await stripe.checkout.sessions.retrieve(
    sessionId,
    { expand: ["payment_intent"] },
    { stripeAccount: stripeAccountId },
  );

  if (payment.status === "accepted") {
    return {
      status: "accepted",
      reason: payment.failureReason ?? undefined,
      snapshot: await getLaptopSnapshot(session.metadata?.laptop_slug ?? ""),
    };
  }
  if (payment.status === "expired") {
    return { status: "expired", reason: payment.failureReason ?? "checkout_expired" };
  }
  if (payment.status === "refunded") {
    return { status: "refunded", reason: payment.failureReason ?? undefined };
  }
  if (payment.status === "failed") {
    return { status: "failed", reason: payment.failureReason ?? undefined };
  }
  if (payment.status === "refund_pending") {
    return { status: "pending", reason: payment.failureReason ?? undefined };
  }

  if (session.status === "expired" && payment.status === "pending") {
    await markBidPaymentStatus(payment.id, "expired", "checkout_expired");
    await removeLogo(payment.logoStoragePath);
    return { status: "expired", reason: "checkout_expired" };
  }
  if (session.payment_status !== "paid") {
    return { status: "pending" };
  }

  const intentId = paymentIntentId(session.payment_intent);
  if (!intentId) throw new Error("A paid Checkout Session is missing its PaymentIntent.");
  await markBidPaymentPaid(payment.id, session.id, intentId);

  const result = await settleLaptopBidPayment(payment.id);
  if (!result.accepted) {
    const reason = result.reason === "auction_closed" || result.reason === "bid_too_low"
      ? result.reason
      : "payment_rejected";
    await refundPaymentIntent(intentId, payment.id, stripeAccountId, reason);
    await removeLogo(payment.logoStoragePath);
    return { status: "refunded", reason: result.reason };
  }

  if (result.previousPaymentIntentId && result.previousPaymentIntentId !== intentId) {
    const previousPayment = await getSupabaseAdmin()
      .from(getLaptopBidPaymentTable())
      .select("id,logo_storage_path")
      .eq("stripe_payment_intent_id", result.previousPaymentIntentId)
      .maybeSingle();
    if (previousPayment.error) throw previousPayment.error;
    if (previousPayment.data) {
      await refundPaymentIntent(
        result.previousPaymentIntentId,
        String(previousPayment.data.id),
        stripeAccountId,
        "outbid",
      );
      await markPaymentIntentRefunded(result.previousPaymentIntentId, "outbid");
      await removeLogo(previousPayment.data.logo_storage_path as string | null);
    }
  }

  return {
    status: "accepted",
    reason: result.reason,
    snapshot: await getLaptopSnapshot(session.metadata?.laptop_slug ?? ""),
  };
}

export async function expireCheckoutSession(sessionId: string) {
  const payment = await getBidPaymentBySessionId(sessionId);
  if (!payment || payment.status !== "pending") return;
  await markBidPaymentStatus(payment.id, "expired", "checkout_expired");
  await removeLogo(payment.logoStoragePath);
}
