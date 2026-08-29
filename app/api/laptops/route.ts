import { createHash } from "node:crypto";

import { getBrandModelMimeType } from "@/lib/brand-model";
import { getBrandModelBucket, getLaptopMediaBucket } from "@/lib/database-names";
import { attachCampaignAsset, createLaptop, getLaptopSnapshot } from "@/lib/laptop-repository";
import { LaptopValidationError, parseLaptopForm } from "@/lib/laptop-validation";
import { normalizeModelClaimInput, verifyModelUploadClaim } from "@/lib/model-upload-claim";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { getPublishingOwner, XAuthenticationError } from "@/lib/x-auth";

export const runtime = "nodejs";

const EXTENSIONS_BY_TYPE: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

async function uploadPhoto(photo: File, slug: string, idempotencyKey: string) {
  const supabase = getSupabaseAdmin();
  const bytes = Buffer.from(await photo.arrayBuffer());
  const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 16);
  const path = `${slug}/${idempotencyKey}-${digest}.${EXTENSIONS_BY_TYPE[photo.type]}`;
  const { error } = await supabase.storage.from(getLaptopMediaBucket()).upload(path, bytes, {
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
  const { error } = await supabase.storage.from(getLaptopMediaBucket()).remove([path]);
  if (error) console.error("Failed to clean up rejected laptop photo", error);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Laptop creation is temporarily unavailable." }, { status: 503 });
  }

  let photoStoragePath: string | null = null;
  let databaseAccepted = false;

  try {
    const owner = await getPublishingOwner(request);
    const formData = await request.formData();
    formData.set("ownerName", owner.ownerName);
    formData.set("ownerEmail", owner.ownerEmail);
    const input = parseLaptopForm(formData);
    if (input.assetType === "anything") {
      const claimInput = normalizeModelClaimInput({
        path: input.modelStoragePath!,
        fileName: input.modelFileName!,
        size: input.modelFileSize!,
      });
      if (!verifyModelUploadClaim(claimInput, input.modelUploadClaim!)) {
        throw new LaptopValidationError("This model upload ticket is invalid or expired. Upload the model again.");
      }
      const { data: modelInfo, error: modelError } = await getSupabaseAdmin().storage
        .from(getBrandModelBucket())
        .info(input.modelStoragePath!);
      if (modelError || !modelInfo) {
        throw new LaptopValidationError("The uploaded 3D model could not be found. Upload it again before publishing.");
      }
      const expectedModelMime = getBrandModelMimeType(input.modelFileName!);
      const storedModelMime = modelInfo.contentType?.split(";", 1)[0]?.toLowerCase();
      if (modelInfo.size !== input.modelFileSize
        || (storedModelMime && storedModelMime !== expectedModelMime && storedModelMime !== "application/octet-stream")) {
        throw new LaptopValidationError("The uploaded 3D model does not match its upload ticket. Upload it again.");
      }
    }
    if (input.photo) {
      photoStoragePath = await uploadPhoto(input.photo, input.slug, input.idempotencyKey);
    }

    const result = await createLaptop({
      slug: input.slug,
      ownerName: input.ownerName,
      ownerEmail: input.ownerEmail,
      title: input.title,
      tagline: input.tagline,
      story: input.story,
      laptopModel: input.laptopModel,
      goalCents: input.goalCents,
      auctionClosesAt: input.auctionClosesAt,
      photoStoragePath,
      smallOpeningBidCents: input.smallOpeningBidCents,
      mediumOpeningBidCents: input.mediumOpeningBidCents,
      largeOpeningBidCents: input.largeOpeningBidCents,
      minIncrementCents: input.minIncrementCents,
      idempotencyKey: input.idempotencyKey,
    });

    if (!result.accepted) {
      await removePhoto(photoStoragePath);
      const status = result.reason === "rate_limited" ? 429 : 409;
      const error = result.reason === "slug_taken"
        ? "That public URL is already taken. Choose another slug."
        : result.reason === "rate_limited"
          ? "This email has created several laptops recently. Please try again in an hour."
          : "This creation request conflicts with one that was already processed.";
      return Response.json({ error, result }, { status });
    }

    databaseAccepted = true;
    if (!result.laptopId) throw new Error("The database accepted the campaign without an id.");
    await attachCampaignAsset({
      laptopId: result.laptopId,
      assetType: input.assetType,
      assetName: input.assetName,
      modelStoragePath: input.modelStoragePath,
      modelFileName: input.modelFileName,
      idempotencyKey: input.idempotencyKey,
    });
    const snapshot = await getLaptopSnapshot(result.slug).catch((error) => {
      console.error("Campaign was created but its first snapshot could not be loaded", error);
      return null;
    });

    return Response.json(
      { result, snapshot, location: `/${result.slug}` },
      { status: result.reason === "created" ? 201 : 200 },
    );
  } catch (error) {
    if (!databaseAccepted) await removePhoto(photoStoragePath);
    if (error instanceof XAuthenticationError) {
      return Response.json(
        { error: error.message },
        {
          status: error.status,
          headers: error.status === 401 ? { "WWW-Authenticate": "Bearer" } : undefined,
        },
      );
    }
    if (error instanceof LaptopValidationError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to create laptop", error);
    return Response.json(
      { error: "We could not publish this laptop. Your details are safe; please try again." },
      { status: 500 },
    );
  }
}
