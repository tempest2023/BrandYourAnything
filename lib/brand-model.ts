export const MAX_BRAND_MODEL_BYTES = 25 * 1024 * 1024;
export const BRAND_MODEL_MIME = "model/gltf-binary";
export const BRAND_MODEL_EXTENSION = ".glb";

export type CampaignAssetType = "laptop" | "anything";

export type UploadedBrandModel = {
  storagePath: string;
  uploadClaim: string;
  fileName: string;
  size: number;
};

export function isGlbFileName(fileName: string) {
  return fileName.trim().toLowerCase().endsWith(BRAND_MODEL_EXTENSION);
}

export function readableFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
