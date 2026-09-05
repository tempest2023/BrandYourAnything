import "server-only";

import { isSupportedBrandModelFileName } from "@/lib/brand-model";
import type { CampaignAssetType } from "@/lib/brand-model";
import { isModelSizeAllowed } from "@/lib/model-upload-claim";
import {
  MAX_SURFACE_SPOTS,
  MIN_SURFACE_SPOTS,
  surfacePlacementType,
  type SpotLayoutItem,
  type SurfaceVector,
} from "@/lib/surface-spots";
import {
  getPresetModel,
  getPresetModelStoragePath,
  type PresetModelId,
} from "@/lib/preset-models";
import {
  isValidCustomShowcase,
  MAX_CUSTOM_SHOWCASE_LENGTH,
} from "@/lib/showcase-options";

export const MAX_AUCTION_PHOTO_BYTES = 5 * 1024 * 1024;

const ACCEPTED_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,46}[a-z0-9_-])$/;
const MODEL_PATH_PATTERN = /^[a-f0-9]{16}\/[a-f0-9-]{36}-[a-zA-Z0-9_-]+\.(?:glb|gltf|obj|fbx|stl|ply)$/i;

export class AuctionValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuctionValidationError";
  }
}

export type ParsedAuctionForm = {
  slug: string;
  ownerName: string;
  ownerEmail: string;
  title: string;
  tagline: string;
  story: string;
  objectName: string;
  assetType: CampaignAssetType;
  assetName: string;
  presetModelId: PresetModelId | null;
  modelStoragePath: string | null;
  modelUploadClaim: string | null;
  modelFileName: string | null;
  modelFileSize: number | null;
  goalCents: number;
  auctionClosesAt: string;
  smallOpeningBidCents: number;
  mediumOpeningBidCents: number;
  largeOpeningBidCents: number;
  minIncrementCents: number;
  spotLayout: SpotLayoutItem[];
  idempotencyKey: string;
  photo: File | null;
};

function requiredText(formData: FormData, key: string, minLength: number, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new AuctionValidationError(`Please enter ${key}.`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new AuctionValidationError(`${key} must be between ${minLength} and ${maxLength} characters.`);
  }
  return normalized;
}

function cents(formData: FormData, key: string, minimum: number, maximum: number) {
  const value = Number(requiredText(formData, key, 1, 12));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new AuctionValidationError(`${key} is outside the allowed range.`);
  }
  return value;
}

function optionalText(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.trim().length > maxLength) {
    throw new AuctionValidationError(`${key} is not valid.`);
  }
  return value.trim();
}

function surfaceVector(value: unknown): SurfaceVector | undefined {
  if (!Array.isArray(value) || value.length !== 3
    || !value.every((component) => typeof component === "number" && Number.isFinite(component) && Math.abs(component) <= 20)) return undefined;
  return [value[0], value[1], value[2]];
}

function parseSpotLayout(formData: FormData, assetType: CampaignAssetType) {
  const layoutCount = Number(requiredText(formData, "layoutCount", 1, 2));
  const minimum = assetType === "anything" ? MIN_SURFACE_SPOTS : 6;
  const maximum = assetType === "anything" ? MAX_SURFACE_SPOTS : 10;
  if (!Number.isInteger(layoutCount) || layoutCount < minimum || layoutCount > maximum
    || (assetType === "laptop" && layoutCount !== 6 && layoutCount !== 10)) {
    throw new AuctionValidationError("Choose a supported number of brand spots.");
  }
  const raw = requiredText(formData, "spotLayout", 2, 12_000);
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new AuctionValidationError("The spot layout could not be read.");
  }
  if (!Array.isArray(parsed) || parsed.length !== layoutCount) {
    throw new AuctionValidationError("The spot layout does not match its spot count.");
  }
  return parsed.map((value, index): SpotLayoutItem => {
    if (!value || typeof value !== "object") throw new AuctionValidationError("A spot layout entry is invalid.");
    const spot = value as Record<string, unknown>;
    const position = surfaceVector(spot.position);
    const normal = surfaceVector(spot.normal);
    const name = typeof spot.name === "string" ? spot.name.trim() : "";
    const dimensions = typeof spot.dimensions === "string" ? spot.dimensions.trim() : "";
    const openingBidCents = spot.openingBidCents;
    const size = String(spot.size);
    const expectedSurfaceDimensions = ["S", "M", "L"].includes(size)
      ? surfacePlacementType(size as SpotLayoutItem["size"])
      : null;
    if (spot.id !== index + 1 || !expectedSurfaceDimensions
      || name.length < 2 || name.length > 80 || dimensions.length < 2 || dimensions.length > 100
      || !Number.isSafeInteger(openingBidCents) || Number(openingBidCents) < 100
      || Number(openingBidCents) > 100_000_000_000
      || (assetType === "anything" && dimensions !== `${expectedSurfaceDimensions.label} · ${expectedSurfaceDimensions.coverage}`)
      || (assetType === "anything" && (!position || !normal))) {
      throw new AuctionValidationError(`Spot ${index + 1} has invalid placement or pricing details.`);
    }
    return {
      id: index + 1,
      name,
      size: size as SpotLayoutItem["size"],
      dimensions,
      openingBidCents: Number(openingBidCents),
      ...(position && normal ? { position, normal } : {}),
    };
  });
}

export function parseAuctionForm(formData: FormData): ParsedAuctionForm {
  const slug = requiredText(formData, "slug", 3, 48).toLowerCase();
  const ownerName = requiredText(formData, "ownerName", 2, 80);
  const ownerEmail = requiredText(formData, "ownerEmail", 3, 254).toLowerCase();
  const title = requiredText(formData, "title", 3, 80);
  const tagline = requiredText(formData, "tagline", 3, 160);
  const story = requiredText(formData, "story", 20, 1200);
  const objectName = requiredText(formData, "objectName", 2, 100);
  const assetTypeValue = requiredText(formData, "assetType", 3, 20);
  const assetType: CampaignAssetType = assetTypeValue === "anything" ? "anything" : "laptop";
  if (assetTypeValue !== assetType) {
    throw new AuctionValidationError("Choose a supported auction object type.");
  }
  const assetName = requiredText(formData, "assetName", 2, 80);
  const customShowcase = optionalText(formData, "customShowcase", MAX_CUSTOM_SHOWCASE_LENGTH);
  if (customShowcase !== null && !isValidCustomShowcase(customShowcase)) {
    throw new AuctionValidationError(
      "Other visibility must use letters, numbers, spaces, and basic punctuation only.",
    );
  }
  const spotLayout = parseSpotLayout(formData, assetType);
  const presetModelIdValue = optionalText(formData, "presetModelId", 64);
  const presetModel = getPresetModel(presetModelIdValue);
  const modelStoragePath = optionalText(formData, "modelStoragePath", 320);
  const modelUploadClaim = optionalText(formData, "modelUploadClaim", 64);
  const modelFileName = optionalText(formData, "modelFileName", 180);
  const modelFileSizeText = optionalText(formData, "modelFileSize", 12);
  const modelFileSize = modelFileSizeText === null ? null : Number(modelFileSizeText);
  const idempotencyKey = requiredText(formData, "idempotencyKey", 36, 36).toLowerCase();
  const goalCents = cents(formData, "goalCents", 100, 100_000_000_000);
  const smallOpeningBidCents = cents(formData, "smallOpeningBidCents", 100, 100_000_000_000);
  const mediumOpeningBidCents = cents(formData, "mediumOpeningBidCents", 100, 100_000_000_000);
  const largeOpeningBidCents = cents(formData, "largeOpeningBidCents", 100, 100_000_000_000);
  const minIncrementCents = cents(formData, "minIncrementCents", 100, 100_000_000);
  const auctionClosesAtInput = requiredText(formData, "auctionClosesAt", 10, 40);
  const auctionClosesAtDate = new Date(auctionClosesAtInput);
  const minimumClose = Date.now() + 60 * 60 * 1000;
  const maximumClose = Date.now() + 90 * 24 * 60 * 60 * 1000;

  if (!SLUG_PATTERN.test(slug)) {
    throw new AuctionValidationError("URL slug can use lowercase letters, numbers, and single hyphens only.");
  }
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    throw new AuctionValidationError("Owner email needs a valid address, for example you@company.com.");
  }
  if (presetModelIdValue && !presetModel) {
    throw new AuctionValidationError("Choose a supported built-in 3D model.");
  }
  if (presetModel && assetType !== "anything") {
    throw new AuctionValidationError("Built-in 3D models are only available for Brand Anything auctions.");
  }
  if (assetType === "anything") {
    if (!presetModel && (!modelStoragePath || !MODEL_PATH_PATTERN.test(modelStoragePath)
      || !modelUploadClaim || !/^[a-f0-9]{64}$/i.test(modelUploadClaim)
      || !modelFileName || !isSupportedBrandModelFileName(modelFileName)
      || modelFileSize === null || !isModelSizeAllowed(modelFileSize))) {
      throw new AuctionValidationError("Upload a valid single-file 3D model before publishing this auction.");
    }
  }
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new AuctionValidationError("The creation request is missing a valid idempotency key.");
  }
  if (!Number.isFinite(auctionClosesAtDate.getTime())
    || auctionClosesAtDate.getTime() <= minimumClose
    || auctionClosesAtDate.getTime() > maximumClose) {
    throw new AuctionValidationError("Auction end must be between one hour and 90 days from now.");
  }

  const photoValue = formData.get("photo");
  const photo = photoValue instanceof File && photoValue.size > 0 ? photoValue : null;
  if (photo && photo.size > MAX_AUCTION_PHOTO_BYTES) {
    throw new AuctionValidationError("Auction photos must be 5 MB or smaller.");
  }
  if (photo && !ACCEPTED_PHOTO_TYPES.has(photo.type)) {
    throw new AuctionValidationError("Auction photos must be PNG, JPG, or WEBP.");
  }

  return {
    slug,
    ownerName,
    ownerEmail,
    title,
    tagline,
    story,
    objectName,
    assetType,
    assetName,
    presetModelId: assetType === "anything" ? presetModel?.id ?? null : null,
    modelStoragePath: assetType === "anything"
      ? (presetModel ? getPresetModelStoragePath(presetModel.id) : modelStoragePath)
      : null,
    modelUploadClaim: assetType === "anything" && !presetModel ? modelUploadClaim : null,
    modelFileName: assetType === "anything" ? presetModel?.fileName ?? modelFileName : null,
    modelFileSize: assetType === "anything" && !presetModel ? modelFileSize : null,
    goalCents,
    auctionClosesAt: auctionClosesAtDate.toISOString(),
    smallOpeningBidCents,
    mediumOpeningBidCents,
    largeOpeningBidCents,
    minIncrementCents,
    spotLayout,
    idempotencyKey,
    photo,
  };
}
