import { createHash, randomUUID } from "node:crypto";

import {
  BRAND_MODEL_ALLOWED_MIME_TYPES,
  getBrandModelFormat,
  getBrandModelMimeType,
  isSupportedBrandModelFileName,
  MAX_BRAND_MODEL_BYTES,
} from "@/lib/brand-model";
import { getBrandModelBucket } from "@/lib/database-names";
import {
  createModelUploadClaim,
  isModelSizeAllowed,
  normalizeModelClaimInput,
} from "@/lib/model-upload-claim";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { getPublishingOwner, XAuthenticationError } from "@/lib/x-auth";

export const runtime = "nodejs";

type UploadTicketRequest = {
  fileName?: unknown;
  size?: unknown;
};

function safeFileStem(fileName: string) {
  return fileName
    .replace(/\.[a-z0-9]+$/i, "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72) || "brand-model";
}

function isMissingBucketError(error: { message?: string; statusCode?: string | number } | null) {
  if (!error) return false;
  return String(error.statusCode) === "404" || /related resource does not exist|bucket.*not found/i.test(error.message || "");
}

async function createSignedModelUploadUrl(bucket: string, path: string) {
  const supabase = getSupabaseAdmin();
  const bucketOptions = {
    public: false,
    fileSizeLimit: MAX_BRAND_MODEL_BYTES,
    allowedMimeTypes: [...BRAND_MODEL_ALLOWED_MIME_TYPES],
  };
  const { error: updateError } = await supabase.storage.updateBucket(bucket, bucketOptions);
  if (isMissingBucketError(updateError)) {
    const { error: createError } = await supabase.storage.createBucket(bucket, bucketOptions);
    if (createError && !/already exists|duplicate/i.test(createError.message)) throw createError;
  } else if (updateError) {
    throw updateError;
  }

  return supabase.storage.from(bucket).createSignedUploadUrl(path);
}

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "3D model uploads are temporarily unavailable." }, { status: 503 });
  }

  try {
    const owner = await getPublishingOwner(request);
    const body = await request.json() as UploadTicketRequest;
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const size = typeof body.size === "number" ? body.size : Number.NaN;

    if (!fileName || fileName.length > 180 || !isSupportedBrandModelFileName(fileName)) {
      return Response.json({ error: "Choose a supported GLB, GLTF, OBJ, FBX, STL, or PLY model." }, { status: 400 });
    }
    if (!isModelSizeAllowed(size)) {
      return Response.json(
        { error: `3D models must be smaller than ${MAX_BRAND_MODEL_BYTES / (1024 * 1024)} MB.` },
        { status: 400 },
      );
    }

    const format = getBrandModelFormat(fileName)!;
    const contentType = getBrandModelMimeType(format)!;
    const ownerScope = createHash("sha256").update(owner.ownerEmail).digest("hex").slice(0, 16);
    const path = `${ownerScope}/${randomUUID()}-${safeFileStem(fileName)}.${format}`;
    const bucket = getBrandModelBucket();
    const { data, error } = await createSignedModelUploadUrl(bucket, path);
    if (error || !data) throw error || new Error("Storage did not issue an upload URL.");

    const claimInput = normalizeModelClaimInput({ path, fileName, size });
    return Response.json({
      bucket,
      path,
      token: data.token,
      signedUrl: data.signedUrl,
      contentType,
      format,
      uploadClaim: createModelUploadClaim(claimInput),
    });
  } catch (error) {
    if (error instanceof XAuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to create a model upload ticket", error);
    return Response.json(
      { error: "We could not prepare this model upload. Please try again." },
      { status: 500 },
    );
  }
}
