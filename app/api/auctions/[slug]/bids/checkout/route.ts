import { createHash } from "node:crypto";

import Stripe from "stripe";

import { BidValidationError, parseBidForm } from "@/lib/bid-validation";
import { getLogoBucket } from "@/lib/database-names";
import { createLaptopBidCheckout, StripeBidError } from "@/lib/stripe-bids";
import { isStripeConfigured } from "@/lib/stripe";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { MAX_SURFACE_SPOTS } from "@/lib/surface-spots";

export const runtime = "nodejs";

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

async function uploadLogo(logo: File, slug: string, spotId: number, idempotencyKey: string) {
  const bytes = Buffer.from(await logo.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `auctions/${slug}/${spotId}/${idempotencyKey}-${digest}.${EXTENSIONS_BY_TYPE[logo.type]}`;
  const { error } = await getSupabaseAdmin().storage.from(getLogoBucket()).upload(path, bytes, {
    cacheControl: "3600",
    contentType: logo.type,
    upsert: false,
  });
  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  return path;
}

async function removeLogo(path: string | null) {
  if (!path) return;
  const { error } = await getSupabaseAdmin().storage.from(getLogoBucket()).remove([path]);
  if (error) console.error("Failed to clean up rejected auction bid logo", { path, message: error.message });
}

function checkoutReturnOrigin(request: Request) {
  const origin = request.headers.get("origin");
  if (origin) {
    try {
      const parsed = new URL(origin);
      if (["http:", "https:"].includes(parsed.protocol)) return parsed.origin;
    } catch {
      // Non-browser clients may send a malformed Origin; use the request URL below.
    }
  }
  return new URL(request.url).origin;
}

export async function POST(request: Request, context: { params: Promise<{ slug: string }> }) {
  if (!isSupabaseConfigured() || !isStripeConfigured()) {
    return Response.json({ error: "Stripe Checkout is not configured for this deployment." }, { status: 503 });
  }

  let logoStoragePath: string | null = null;
  try {
    const { slug } = await context.params;
    const input = parseBidForm(await request.formData(), MAX_SURFACE_SPOTS);
    if (input.logo) logoStoragePath = await uploadLogo(input.logo, slug, input.spotId, input.idempotencyKey);
    const returnOrigin = checkoutReturnOrigin(request);
    return Response.json(await createLaptopBidCheckout(slug, input, logoStoragePath, returnOrigin), { status: 201 });
  } catch (error) {
    if (error instanceof BidValidationError) {
      await removeLogo(logoStoragePath);
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StripeBidError) {
      if (["campaign_not_found", "spot_not_found", "auction_closed", "payments_not_ready", "bid_too_low", "idempotency_conflict"].includes(error.code)) {
        await removeLogo(logoStoragePath);
      }
      const status = error.code === "campaign_not_found" || error.code === "spot_not_found" ? 404
        : error.code === "payments_not_ready" ? 503 : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      return Response.json({ error: "The Stripe key needs Checkout Sessions: Write permission." }, { status: 503 });
    }
    await removeLogo(logoStoragePath);
    console.error("Failed to start Stripe Checkout for auction bid", error);
    return Response.json({ error: "Stripe Checkout could not be started. Please try again." }, { status: 500 });
  }
}
