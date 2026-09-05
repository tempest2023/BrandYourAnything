import { createHash } from "node:crypto";

import type { AuctionPublishErrorCode } from "@/lib/auction-api-errors";
import { getBrandModelMimeType } from "@/lib/brand-model";
import { getAuctionMediaBucket, getBrandModelBucket } from "@/lib/database-names";
import { attachCampaignAsset, createAuction, getAuctionSnapshot } from "@/lib/campaign-auction-repository";
import { AuctionValidationError, parseAuctionForm } from "@/lib/auction-validation";
import { normalizeModelClaimInput, verifyModelUploadClaim } from "@/lib/model-upload-claim";
import { getPublishingOwner, PublishingAuthenticationError } from "@/lib/publishing-auth";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function errorResponse(errorCode: AuctionPublishErrorCode, status: number, headers?: HeadersInit) {
  return Response.json({ errorCode }, { status, headers });
}

async function uploadPhoto(photo: File, slug: string, idempotencyKey: string) {
  const supabase = getSupabaseAdmin();
  const bytes = Buffer.from(await photo.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `${slug}/${idempotencyKey}-${digest}.${EXTENSIONS_BY_TYPE[photo.type]}`;
  const { error } = await supabase.storage.from(getAuctionMediaBucket()).upload(path, bytes, {
    cacheControl: "3600",
    contentType: photo.type,
    upsert: false,
  });

  if (error && !/already exists|duplicate/i.test(error.message)) throw error;
  return path;
}

async function removePhoto(path: string | null) {
  if (!path) return;
  const supabase = getSupabaseAdmin();
  const { error } = await supabase.storage.from(getAuctionMediaBucket()).remove([path]);
  if (error) console.error("Failed to clean up rejected auction photo", error);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return errorResponse("publish_unavailable", 503);
  }

  let photoStoragePath: string | null = null;
  let databaseAccepted = false;

  try {
    const owner = await getPublishingOwner(request);
    const formData = await request.formData();
    formData.set("ownerName", owner.ownerName);
    formData.set("ownerEmail", owner.ownerEmail);
    const input = parseAuctionForm(formData);
    if (input.assetType === "anything" && !input.presetModelId) {
      const claimInput = normalizeModelClaimInput({
        path: input.modelStoragePath!,
        fileName: input.modelFileName!,
        size: input.modelFileSize!,
      });
      if (!verifyModelUploadClaim(claimInput, input.modelUploadClaim!)) {
        throw new AuctionValidationError("This model upload ticket is invalid or expired. Upload the model again.");
      }
      const { data: modelInfo, error: modelError } = await getSupabaseAdmin().storage
        .from(getBrandModelBucket())
        .info(input.modelStoragePath!);
      if (modelError || !modelInfo) {
        throw new AuctionValidationError("The uploaded 3D model could not be found. Upload it again before publishing.");
      }
      const expectedModelMime = getBrandModelMimeType(input.modelFileName!);
      const storedModelMime = modelInfo.contentType?.split(";", 1)[0]?.toLowerCase();
      if (modelInfo.size !== input.modelFileSize
        || (storedModelMime && storedModelMime !== expectedModelMime && storedModelMime !== "application/octet-stream")) {
        throw new AuctionValidationError("The uploaded 3D model does not match its upload ticket. Upload it again.");
      }
    }
    if (input.photo) {
      photoStoragePath = await uploadPhoto(input.photo, input.slug, input.idempotencyKey);
    }

    const result = await createAuction({
      slug: input.slug,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      title: input.title,
      tagline: input.tagline,
      story: input.story,
      objectName: input.objectName,
      goalCents: input.goalCents,
      auctionClosesAt: input.auctionClosesAt,
      photoStoragePath,
      smallOpeningBidCents: input.smallOpeningBidCents,
      mediumOpeningBidCents: input.mediumOpeningBidCents,
      largeOpeningBidCents: input.largeOpeningBidCents,
      minIncrementCents: input.minIncrementCents,
      spotLayout: input.spotLayout,
      idempotencyKey: input.idempotencyKey,
    });

    if (!result.accepted) {
      await removePhoto(photoStoragePath);
      const status = result.reason === "rate_limited" ? 429 : 409;
      const errorCode: AuctionPublishErrorCode = result.reason === "slug_taken"
        ? "slug_taken"
        : result.reason === "rate_limited"
          ? "rate_limited"
          : "request_conflict";
      return Response.json({ errorCode, result }, { status });
    }

    databaseAccepted = true;
    if (!result.auctionId) throw new Error("The database accepted the campaign without an id.");
    await attachCampaignAsset({
      auctionId: result.auctionId,
      assetType: input.assetType,
      assetName: input.assetName,
      modelStoragePath: input.modelStoragePath,
      modelFileName: input.modelFileName,
      idempotencyKey: input.idempotencyKey,
    });
    const snapshot = await getAuctionSnapshot(result.slug).catch((error) => {
      console.error("Campaign was created but its first snapshot could not be loaded", error);
      return null;
    });

    return Response.json(
      { result, snapshot, location: `/${result.slug}` },
      { status: result.reason === "created" ? 201 : 200 },
    );
  } catch (error) {
    if (!databaseAccepted) await removePhoto(photoStoragePath);
    if (error instanceof PublishingAuthenticationError) {
      return errorResponse(
        error.status === 401 ? "authentication_required" : "authentication_forbidden",
        error.status,
        error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
      );
    }
    if (error instanceof AuctionValidationError) {
      return errorResponse("invalid_request", 400);
    }
    console.error("Failed to create auction", error);
    return errorResponse("publish_failed", 500);
  }
}
