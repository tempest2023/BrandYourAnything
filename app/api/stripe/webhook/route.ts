import Stripe from "stripe";

import { getBidPaymentById, hasCampaignForStripeAccount, stripeEnvironment, updateCampaignsForStripeAccount } from "@/lib/stripe-bid-repository";
import { expireCheckoutSession, fulfillCheckoutSession, reconcilePendingRefunds, StripeBidError } from "@/lib/stripe-bids";
import { getStripe, getStripeMerchantAccountState, getStripeWebhookSecrets, isStripeConfigured, stripeIsLive } from "@/lib/stripe";

export const runtime = "nodejs";

export async function POST(request: Request) {
  if (!isStripeConfigured()) {
    return Response.json({ error: "Stripe is not configured." }, { status: 503 });
  }

  const signature = request.headers.get("stripe-signature");
  if (!signature) return Response.json({ error: "Missing Stripe signature." }, { status: 400 });

  let event: Stripe.Event;
  try {
    const body = await request.text();
    let verifiedEvent: Stripe.Event | null = null;
    for (const secret of getStripeWebhookSecrets()) {
      try {
        verifiedEvent = getStripe().webhooks.constructEvent(body, signature, secret);
        break;
      } catch {
        // Platform and connected-account webhook endpoints have different secrets.
      }
    }
    if (!verifiedEvent) throw new Error("No configured signing secret matched this event.");
    event = verifiedEvent;
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid signature";
    return Response.json({ error: `Webhook signature verification failed: ${message}` }, { status: 400 });
  }

  try {
    if (event.livemode !== stripeIsLive()) return Response.json({ received: true, ignored: true });
    if (event.type.startsWith("checkout.session.")) {
      const session = event.data.object as Stripe.Checkout.Session;
      if (!event.account || session.metadata?.environment !== stripeEnvironment()
        || !/^[0-9a-f-]{36}$/i.test(session.metadata?.bid_payment_id || "")) {
        return Response.json({ received: true, ignored: true });
      }
    }
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await fulfillCheckoutSession(
          session.id,
          typeof event.account === "string" ? event.account : undefined,
          undefined,
          session.metadata?.bid_payment_id,
        );
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await expireCheckoutSession(session.id, event.account, session.metadata?.bid_payment_id);
        break;
      }
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        if (!await hasCampaignForStripeAccount(account.id)) break;
        // Events may be delivered out of order; never restore stale capability flags.
        const current = await getStripeMerchantAccountState(account.id);
        await updateCampaignsForStripeAccount(
          account.id,
          !current.closed && current.chargesEnabled,
          !current.closed && current.payoutsEnabled,
        );
        break;
      }
      case "refund.created":
      case "refund.updated":
      case "refund.failed": {
        const refund = event.data.object as Stripe.Refund;
        const paymentId = refund.metadata?.bid_payment_id;
        if (!paymentId || !/^[0-9a-f-]{36}$/i.test(paymentId)) break;
        const payment = await getBidPaymentById(paymentId);
        if (!payment || !event.account || payment.stripeAccountId !== event.account) break;
        const result = await reconcilePendingRefunds(payment.laptopId, payment.id);
        if (result.failed.length || result.budgetExhausted) throw new Error("A queued refund needs retry.");
        break;
      }
      default:
        break;
    }
  } catch (error) {
    if (error instanceof StripeBidError && error.code === "checkout_unavailable") return Response.json({ received: true, ignored: true });
    const stripeError = error instanceof Stripe.errors.StripeError
      ? { type: error.type, code: error.code, requestId: error.requestId }
      : error;
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type, error: stripeError });
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }

  return Response.json({ received: true });
}
