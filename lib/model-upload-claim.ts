import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

import { getBrandModelMimeType, MAX_BRAND_MODEL_BYTES } from "@/lib/brand-model";

type ModelUploadClaim = {
  path: string;
  fileName: string;
  size: number;
  mimeType: string;
};

function signingSecret() {
  const secret = process.env.MODEL_UPLOAD_SIGNING_SECRET
    || process.env.SUPABASE_SECRET_KEY
    || process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!secret) throw new Error("Model upload signing is not configured.");
  return secret;
}

function payload(input: ModelUploadClaim) {
  return [input.path, input.fileName, input.size, input.mimeType].join("\n");
}

export function createModelUploadClaim(input: ModelUploadClaim) {
  return createHmac("sha256", signingSecret()).update(payload(input)).digest("hex");
}

export function verifyModelUploadClaim(input: ModelUploadClaim, claim: string) {
  if (!/^[a-f0-9]{64}$/i.test(claim)) return false;
  const expected = Buffer.from(createModelUploadClaim(input), "hex");
  const candidate = Buffer.from(claim, "hex");
  return candidate.length === expected.length && timingSafeEqual(candidate, expected);
}

export function normalizeModelClaimInput(input: {
  path: string;
  fileName: string;
  size: number;
}) {
  const mimeType = getBrandModelMimeType(input.fileName);
  if (!mimeType) throw new Error("Unsupported 3D model format.");
  return {
    path: input.path.trim(),
    fileName: input.fileName.trim().slice(0, 180),
    size: input.size,
    mimeType,
  } satisfies ModelUploadClaim;
}

export function isModelSizeAllowed(size: number) {
  return Number.isSafeInteger(size) && size > 0 && size <= MAX_BRAND_MODEL_BYTES;
}
