import { createHash } from "node:crypto";

import { getAuctionSnapshot, placeBid } from "@/lib/auction-repository";
import { BidValidationError, parseBidForm } from "@/lib/bid-validation";
import { getLogoBucket } from "@/lib/database-names";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/svg+xml": "svg",
  "image/webp": "webp",
};

async function uploadLogo(logo: File, spotId: number, idempotencyKey: string) {
  const supabase = getSupabaseAdmin();
  const bytes = Buffer.from(await logo.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const extension = EXTENSIONS_BY_TYPE[logo.type];
  const path = `${spotId}/${idempotencyKey}-${digest}.${extension}`;
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
  if (error) console.error("Failed to clean up rejected bid logo", error);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auction backend is not configured." }, { status: 503 });
  }

  let logoStoragePath: string | null = null;

  try {
    const input = parseBidForm(await request.formData());
    if (input.logo) {
      logoStoragePath = await uploadLogo(input.logo, input.spotId, input.idempotencyKey);
    }

    const result = await placeBid({
      spotId: input.spotId,
      amountCents: input.amountCents,
      brandName: input.brandName,
      email: input.email,
      website: input.website,
      xHandle: input.xHandle,
      logoStoragePath,
      idempotencyKey: input.idempotencyKey,
    });

    if (!result.accepted) await removeLogo(logoStoragePath);
    const snapshot = await getAuctionSnapshot();

    if (!result.accepted) {
      const message = result.reason === "bid_too_low"
        ? `Another bidder moved first. The new minimum is €${result.minimumNextBid.toLocaleString("en-US")}.`
        : result.reason === "auction_closed"
          ? "This auction has closed."
          : "This request conflicts with a bid that was already processed.";
      return Response.json({ error: message, result, snapshot }, { status: 409 });
    }

    return Response.json({ result, snapshot }, { status: result.reason === "accepted" ? 201 : 200 });
  } catch (error) {
    await removeLogo(logoStoragePath);
    if (error instanceof BidValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }

    console.error("Failed to place bid", error);
    return Response.json({ error: "The bid could not be saved. Please try again." }, { status: 500 });
  }
}
