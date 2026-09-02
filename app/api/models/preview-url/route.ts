import {
  getBrandModelFormat,
  getBrandModelMimeType,
  isSupportedBrandModelFileName,
} from "@/lib/brand-model";
import { getBrandModelBucket } from "@/lib/database-names";
import {
  isModelSizeAllowed,
  normalizeModelClaimInput,
  verifyModelUploadClaim,
} from "@/lib/model-upload-claim";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MODEL_PATH_PATTERN = /^[a-f0-9]{16}\/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.(?:glb|gltf|obj|fbx|stl|ply)$/i;
const PREVIEW_URL_SECONDS = 60 * 60;

type PreviewUrlRequest = {
  path?: unknown;
  fileName?: unknown;
  size?: unknown;
  uploadClaim?: unknown;
};

export async function POST(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "3D model previews are temporarily unavailable." }, { status: 503 });
  }

  try {
    const body = await request.json() as PreviewUrlRequest;
    const path = typeof body.path === "string" ? body.path.trim() : "";
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const size = typeof body.size === "number" ? body.size : Number.NaN;
    const uploadClaim = typeof body.uploadClaim === "string" ? body.uploadClaim.trim() : "";

    if (!MODEL_PATH_PATTERN.test(path)
      || !fileName
      || fileName.length > 180
      || !isSupportedBrandModelFileName(fileName)
      || !isModelSizeAllowed(size)) {
      return Response.json({ error: "This saved 3D model reference is not valid." }, { status: 400 });
    }

    const claimInput = normalizeModelClaimInput({ path, fileName, size });
    if (!verifyModelUploadClaim(claimInput, uploadClaim)) {
      return Response.json({ error: "This saved 3D model reference has expired or changed." }, { status: 403 });
    }

    const storage = getSupabaseAdmin().storage.from(getBrandModelBucket());
    const { data: modelInfo, error: modelError } = await storage.info(path);
    if (modelError || !modelInfo) {
      return Response.json({ error: "The uploaded 3D model could not be found." }, { status: 404 });
    }

    const expectedMime = getBrandModelMimeType(fileName);
    const storedMime = modelInfo.contentType?.split(";", 1)[0]?.toLowerCase();
    if (modelInfo.size !== size
      || (storedMime && storedMime !== expectedMime && storedMime !== "application/octet-stream")) {
      return Response.json({ error: "The uploaded 3D model no longer matches this draft." }, { status: 409 });
    }

    const { data, error } = await storage.createSignedUrl(path, PREVIEW_URL_SECONDS);
    if (error || !data?.signedUrl) throw error || new Error("Storage did not issue a preview URL.");

    return Response.json(
      {
        sourceUrl: data.signedUrl,
        format: getBrandModelFormat(fileName),
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Failed to restore a saved model preview", error);
    return Response.json(
      { error: "We could not restore this 3D model preview. Choose the file again to retry." },
      { status: 500 },
    );
  }
}
