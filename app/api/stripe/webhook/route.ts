import Stripe from "stripe";

import { updateCampaignsForStripeAccount } from "@/lib/stripe-bid-repository";
import { expireCheckoutSession, fulfillCheckoutSession } from "@/lib/stripe-bids";
import { getStripe, getStripeWebhookSecrets, isStripeConfigured } from "@/lib/stripe";

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
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded": {
        const session = event.data.object as Stripe.Checkout.Session;
        await fulfillCheckoutSession(
          session.id,
          typeof event.account === "string" ? event.account : undefined,
        );
        break;
      }
      case "checkout.session.expired": {
        const session = event.data.object as Stripe.Checkout.Session;
        await expireCheckoutSession(session.id);
        break;
      }
      case "account.updated": {
        const account = event.data.object as Stripe.Account;
        await updateCampaignsForStripeAccount(
          account.id,
          account.charges_enabled,
          account.payouts_enabled,
        );
        break;
      }
      default:
        break;
    }
  } catch (error) {
    const stripeError = error instanceof Stripe.errors.StripeError
      ? { type: error.type, code: error.code, requestId: error.requestId }
      : error;
    console.error("Stripe webhook processing failed", { eventId: event.id, type: event.type, error: stripeError });
    return Response.json({ error: "Webhook processing failed." }, { status: 500 });
  }

  return Response.json({ received: true });
}
