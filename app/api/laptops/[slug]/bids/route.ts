import { createHash } from "node:crypto";

import { BidValidationError, parseBidForm } from "@/lib/bid-validation";
import { getLogoBucket } from "@/lib/database-names";
import { getLaptopSnapshot, placeLaptopBid } from "@/lib/laptop-repository";
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
    return Response.json({ error: "Auction bidding is temporarily unavailable." }, { status: 503 });
  }

  let logoStoragePath: string | null = null;
  let databaseAccepted = false;

  try {
    const { slug } = await context.params;
    const input = parseBidForm(await request.formData(), MAX_SURFACE_SPOTS);
    if (input.logo) {
      logoStoragePath = await uploadLogo(input.logo, slug, input.spotId, input.idempotencyKey);
    }

    const result = await placeLaptopBid({
      slug,
      spotPosition: input.spotId,
      amountCents: input.amountCents,
      brandName: input.brandName,
      email: input.email,
      website: input.website,
      xHandle: input.xHandle,
      logoStoragePath,
      idempotencyKey: input.idempotencyKey,
    });

    if (!result.accepted) {
      await removeLogo(logoStoragePath);
      const snapshot = await getLaptopSnapshot(slug).catch(() => null);
      const status = result.reason === "campaign_not_found" ? 404 : 409;
      const error = result.reason === "bid_too_low"
        ? `Another bidder moved first. The new minimum is $${result.minimumNextBid.toLocaleString("en-US")}.`
        : result.reason === "auction_closed"
          ? "This auction has closed."
          : result.reason === "campaign_not_found"
            ? "This auction does not exist."
            : "This request conflicts with a bid that was already processed.";
      return Response.json({ error, result, snapshot }, { status });
    }

    databaseAccepted = true;
    const snapshot = await getLaptopSnapshot(slug).catch((error) => {
      console.error("Laptop bid succeeded but its snapshot could not be refreshed", error);
      return null;
    });
    return Response.json(
      { result, snapshot },
      { status: result.reason === "accepted" ? 201 : 200 },
    );
  } catch (error) {
    if (!databaseAccepted) await removeLogo(logoStoragePath);
    if (error instanceof BidValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to place laptop bid", error);
    return Response.json({ error: "The bid could not be saved. Please try again." }, { status: 500 });
  }
}
