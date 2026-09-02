import { createHash } from "node:crypto";

import Stripe from "stripe";

import { BidValidationError, parseBidForm } from "@/lib/bid-validation";
import { getLogoBucket } from "@/lib/database-names";
import { createLaptopBidCheckout, StripeBidError } from "@/lib/stripe-bids";
import { isStripeConfigured } from "@/lib/stripe";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

async function uploadLogo(logo: File, slug: string, spotId: number, idempotencyKey: string) {
  const supabase = getSupabaseAdmin();
  const bytes = Buffer.from(await logo.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `laptops/${slug}/${spotId}/${idempotencyKey}-${digest}.${EXTENSIONS_BY_TYPE[logo.type]}`;
  const { error } = await supabase.storage.from(getLogoBucket()).upload(path, bytes, {
    cacheControl: "3600",
    contentType: logo.type,
    upsert: false,
  });

  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  return path;
}

async function removeLogo(path: string | null) {
  if (!path) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(getLogoBucket()).remove([path]);
  if (error) console.error("Failed to clean up rejected laptop bid logo", error);
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Laptop bidding is temporarily unavailable." }, { status: 503 });
  }

  let logoStoragePath: string | null = null;
  try {
    const { slug } = await context.params;
    if (!isStripeConfigured()) {
      return Response.json(
        { error: "Stripe Checkout is not configured for this deployment." },
        { status: 503 },
      );
    }
    const input = parseBidForm(await request.formData());
    if (input.logo) {
      logoStoragePath = await uploadLogo(input.logo, slug, input.spotId, input.idempotencyKey);
    }

    const checkout = await createLaptopBidCheckout(slug, input, logoStoragePath);
    return Response.json(checkout, { status: 201 });
  } catch (error) {
    if (error instanceof BidValidationError) {
      await removeLogo(logoStoragePath);
      return Response.json({ error: error.message }, { status: 400 });
    }
    if (error instanceof StripeBidError) {
      if (["campaign_not_found", "spot_not_found", "auction_closed", "payments_not_ready", "bid_too_low", "idempotency_conflict"].includes(error.code)) {
        await removeLogo(logoStoragePath);
      }
      const status = error.code === "campaign_not_found" || error.code === "spot_not_found"
        ? 404
        : error.code === "payments_not_ready"
          ? 503
          : 409;
      return Response.json({ error: error.message, code: error.code }, { status });
    }
    if (error instanceof Stripe.errors.StripePermissionError) {
      console.error("Stripe Checkout key is missing permissions", {
        code: error.code,
        requestId: error.requestId,
      });
      return Response.json(
        { error: "The Stripe key needs Checkout Sessions: Write permission." },
        { status: 503 },
      );
    }
    console.error("Failed to start Stripe Checkout for laptop bid", error);
    return Response.json({ error: "Stripe Checkout could not be started. Please try again." }, { status: 500 });
  }
}
