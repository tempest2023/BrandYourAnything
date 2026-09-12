import { fulfillCheckoutSession, StripeBidError } from "@/lib/stripe-bids";
import { isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";

const CHECKOUT_SESSION_PATTERN = /^cs_(?:test_|live_)?[A-Za-z0-9]+$/;

export async function GET(
  _request: Request,
  context: { params: Promise<{ sessionId: string }> },
) {
  if (!isStripeConfigured()) {
    return Response.json({ error: "Stripe is not configured." }, { status: 503 });
  }
  try {
    const { sessionId } = await context.params;
    if (!CHECKOUT_SESSION_PATTERN.test(sessionId)) {
      return Response.json({ error: "Invalid Checkout Session." }, { status: 400 });
    }
    return Response.json(await fulfillCheckoutSession(sessionId), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    if (error instanceof StripeBidError) {
      return Response.json({ error: error.message }, { status: 404 });
    }
    console.error("Failed to fulfill Stripe Checkout from return page", error);
    return Response.json({ error: "Payment confirmation is still pending." }, { status: 503 });
  }
}
