import { createHash } from "node:crypto";

import Stripe from "stripe";

import { BidValidationError, parseBidForm } from "@/lib/bid-validation";
import { getLogoBucket } from "@/lib/database-names";
import { createLaptopBidCheckout, StripeBidError } from "@/lib/stripe-bids";
import { isStripeConfigured } from "@/lib/stripe";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { MAX_SURFACE_SPOTS } from "@/lib/surface-spots";
import { getRequestOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

async function prepareLogo(logo: File, slug: string, spotId: number, idempotencyKey: string) {
  const bytes = Buffer.from(await logo.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `auctions/${slug}/${spotId}/${idempotencyKey}-${digest}.${EXTENSIONS_BY_TYPE[logo.type]}`;
  return { path, upload: async () => {
    const { error } = await getSupabaseAdmin().storage.from(getLogoBucket()).upload(path, bytes, {
      cacheControl: "3600", contentType: logo.type, upsert: false,
    });
    if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  } };
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured() || !isStripeConfigured()) {
    return Response.json({ error: "Stripe Checkout is not configured for this deployment." }, { status: 503 });
  }

  try {
    const { slug } = await context.params;
    const input = parseBidForm(await request.formData(), MAX_SURFACE_SPOTS);
    const logo = input.logo ? await prepareLogo(input.logo, slug, input.spotId, input.idempotencyKey) : null;
    // Origin is not a caller-selected redirect destination. Preserve this deployment.
    return Response.json(await createLaptopBidCheckout(slug, input, logo?.path ?? null, getRequestOrigin(request), logo?.upload), { status: 201 });
  } catch (error) {
    // Uploaded objects have a durable payment reservation. Never delete them on
    // ambiguous network failures or idempotent retries of an accepted bid.
    if (error instanceof BidValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StripeBidError) {
      const status = error.code === "campaign_not_found" || error.code === "spot_not_found" ? 404
        : error.code === "payments_not_ready" ? 503 : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      return Response.json({ error: "The Stripe key needs Checkout Sessions: Write permission." }, { status: 503 });
    }
    console.error("Failed to start Stripe Checkout for auction bid", error);
    return Response.json({ error: "Stripe Checkout could not be started. Please try again." }, { status: 500 });
  }
}
