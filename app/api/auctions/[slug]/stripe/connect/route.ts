import Stripe from "stripe";
import { isStripeConfigured } from "@/lib/stripe";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { getPublishingOwnerCredential, PublishingAuthenticationError } from "@/lib/publishing-auth";
import { getRequestOrigin } from "@/lib/request-origin";
import { readOwnedStripeStatus, startOwnedStripeOnboarding } from "@/lib/stripe-connect";
import { StripeConnectError } from "@/lib/stripe-connect-repository";

export const runtime = "nodejs";

function json(value: unknown, status = 200) {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

async function handle(request: Request, context: { params: Promise<{ slug: string }> }, start: boolean) {
  if (!isSupabaseConfigured() || !isStripeConfigured()) return json({ error: "Stripe Connect is not configured for this deployment." }, 503);
  try {
    const { slug } = await context.params;
    const owner = await getPublishingOwnerCredential(request);
    let country: string | undefined;
    if (start) {
      const body = await request.text();
      if (body) {
        let value;
        try { value = JSON.parse(body); } catch { throw new StripeConnectError(400, "Invalid Stripe setup request."); }
        if (!value || typeof value !== "object" || Array.isArray(value)
          || (value.country !== undefined && (typeof value.country !== "string" || !/^[A-Z]{2}$/.test(value.country)))) {
          throw new StripeConnectError(400, "Choose a two-letter country code for your business.");
        }
        country = value.country;
      }
    }
    return json(start
      ? await startOwnedStripeOnboarding(slug, owner, getRequestOrigin(request), country)
      : await readOwnedStripeStatus(slug, owner));
  } catch (error) {
    if (error instanceof PublishingAuthenticationError || error instanceof StripeConnectError) return json({ error: error.message }, error.status);
    if (error instanceof Stripe.errors.StripePermissionError) return json({ error: "The Stripe key needs Core: Read/Write permission for Accounts v2." }, 503);
    console.error("Stripe Connect request failed", error instanceof Stripe.errors.StripeError
      ? { type: error.type, code: error.code, parameter: error.param, requestId: error.requestId } : error);
    return json({ error: "Stripe setup could not finish. Retry is safe; contact support if the problem persists." }, 500);
  }
}

export function GET(request: Request, context: { params: Promise<{ slug: string }> }) { return handle(request, context, false); }
export function POST(request: Request, context: { params: Promise<{ slug: string }> }) { return handle(request, context, true); }
