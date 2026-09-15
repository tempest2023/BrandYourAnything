import { getBrandModelMimeType, isSupportedBrandModelFileName } from "@/lib/brand-model";
import { attachOwnedCampaignModel } from "@/lib/auction-ownership";
import { getBrandModelBucket } from "@/lib/database-names";
import { getLaptopSnapshot } from "@/lib/laptop-repository";
import {
  isModelSizeAllowed,
  normalizeModelClaimInput,
  verifyModelUploadClaim,
} from "@/lib/model-upload-claim";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { getPublishingOwnerCredential, PublishingAuthenticationError } from "@/lib/publishing-auth";

export const runtime = "nodejs";

const MODEL_PATH_PATTERN = /^([a-f0-9]{16})\/([a-f0-9-]{36})-[a-zA-Z0-9_-]+\.(?:glb|gltf|obj|fbx|stl|ply)$/i;

type ModelRepairRequest = {
  expectedAssetVersion?: unknown;
  assetName?: unknown;
  path?: unknown;
  fileName?: unknown;
  size?: unknown;
  uploadClaim?: unknown;
};

export async function PUT(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auction model repair is temporarily unavailable." }, { status: 503 });
  }

  try {
    const owner = await getPublishingOwnerCredential(request);
    const { slug } = await context.params;
    const body = await request.json() as ModelRepairRequest;
    if (!body || typeof body !== "object" || Array.isArray(body)) return Response.json({ error: "Invalid model repair request." }, { status: 400 });
    const assetName = typeof body.assetName === "string" ? body.assetName.trim() : "";
    const path = typeof body.path === "string" ? body.path.trim() : "";
    const fileName = typeof body.fileName === "string" ? body.fileName.trim() : "";
    const size = typeof body.size === "number" ? body.size : Number.NaN;
    const uploadClaim = typeof body.uploadClaim === "string" ? body.uploadClaim.trim() : "";
    const pathMatch = path.match(MODEL_PATH_PATTERN);
    const expectedAssetVersion = body.expectedAssetVersion;

    if ((expectedAssetVersion !== null && (typeof expectedAssetVersion !== "string" || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(expectedAssetVersion)))
      || assetName.length < 2
      || assetName.length > 80
      || !pathMatch
      || !fileName
      || fileName.length > 180
      || !isSupportedBrandModelFileName(fileName)
      || !isModelSizeAllowed(size)) {
      return Response.json({ error: "This 3D model repair request is not valid." }, { status: 400 });
    }

    const claimInput = normalizeModelClaimInput({ path, fileName, size });
    if (!verifyModelUploadClaim(claimInput, uploadClaim)) {
      return Response.json({ error: "This 3D model upload could not be verified." }, { status: 403 });
    }

    const { data: modelInfo, error: modelError } = await getSupabaseAdmin().storage
      .from(getBrandModelBucket())
      .info(path);
    if (modelError || !modelInfo) {
      return Response.json({ error: "The uploaded 3D model could not be found." }, { status: 404 });
    }
    const expectedMime = getBrandModelMimeType(fileName);
    const storedMime = modelInfo.contentType?.split(";", 1)[0]?.toLowerCase();
    if (modelInfo.size !== size
      || (storedMime && storedMime !== expectedMime && storedMime !== "application/octet-stream")) {
      return Response.json({ error: "The uploaded 3D model no longer matches this repair request." }, { status: 409 });
    }

    const auction = await attachOwnedCampaignModel(slug, owner, {
      expectedAssetVersion,
      assetName,
      modelStoragePath: path,
      modelFileName: fileName,
      idempotencyKey: pathMatch[2],
    });
    if (!auction) {
      return Response.json({ error: "This owner key does not manage the auction." }, { status: 404 });
    }
    const snapshot = await getLaptopSnapshot(slug);
    return Response.json({ auction, snapshot, location: `/${auction.slug}` });
  } catch (error) {
    if (error instanceof PublishingAuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof Error && error.message === "auction_model_locked_by_bids") {
      return Response.json(
        { error: "This auction already has bids, so its advertised object can no longer be changed." },
        { status: 409 },
      );
    }
    if (error instanceof Error && error.message === "auction_model_locked_by_payments") {
      return Response.json({ error: "A bidder is checking out. The advertised object cannot change until pending payments are resolved." }, { status: 409 });
    }
    if (error instanceof Error && error.message === "auction_asset_changed") {
      return Response.json({ error: "The auction model changed. Refresh it before starting another repair." }, { status: 409 });
    }
    if (error instanceof SyntaxError) return Response.json({ error: "Invalid JSON." }, { status: 400 });
    if (error instanceof Error && error.message === "auction_closed") return Response.json({ error: "A closed auction cannot change its object." }, { status: 409 });
    console.error("Failed to attach a model to an owned auction", error);
    return Response.json({ error: "The auction model could not be repaired." }, { status: 500 });
  }
}
