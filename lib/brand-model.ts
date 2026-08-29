export const MAX_BRAND_MODEL_BYTES = 25 * 1024 * 1024;
export const BRAND_MODEL_MIME = "model/gltf-binary";
export const BRAND_MODEL_EXTENSION = ".glb";

export const BRAND_MODEL_FORMATS = ["glb", "gltf", "obj", "fbx", "stl", "ply"] as const;
export type BrandModelFormat = (typeof BRAND_MODEL_FORMATS)[number];

export const BRAND_MODEL_MIME_BY_FORMAT: Record<BrandModelFormat, string> = {
  glb: BRAND_MODEL_MIME,
  gltf: "model/gltf+json",
  obj: "model/obj",
  fbx: "application/octet-stream",
  stl: "model/stl",
  ply: "application/octet-stream",
};

export const BRAND_MODEL_ALLOWED_MIME_TYPES = [
  BRAND_MODEL_MIME,
  "model/gltf+json",
  "model/obj",
  "model/stl",
  "application/octet-stream",
] as const;

export const BRAND_MODEL_ACCEPT = BRAND_MODEL_FORMATS.map((format) => `.${format}`).join(",");

export type CampaignAssetType = "laptop" | "anything";

export type UploadedBrandModel = {
  storagePath: string;
  uploadClaim: string;
  fileName: string;
  size: number;
  format?: BrandModelFormat;
};

export function isGlbFileName(fileName: string) {
  return fileName.trim().toLowerCase().endsWith(BRAND_MODEL_EXTENSION);
}

export function getBrandModelFormat(fileNameOrUrl: string): BrandModelFormat | null {
  const cleanName = fileNameOrUrl.split(/[?#]/, 1)[0]?.trim().toLowerCase() || "";
  const format = BRAND_MODEL_FORMATS.find((candidate) => cleanName.endsWith(`.${candidate}`));
  return format ?? null;
}

export function isSupportedBrandModelFileName(fileName: string) {
  return getBrandModelFormat(fileName) !== null;
}

export function getBrandModelMimeType(fileNameOrFormat: string) {
  const format = BRAND_MODEL_FORMATS.includes(fileNameOrFormat as BrandModelFormat)
    ? fileNameOrFormat as BrandModelFormat
    : getBrandModelFormat(fileNameOrFormat);
  return format ? BRAND_MODEL_MIME_BY_FORMAT[format] : null;
}

export function brandModelFormatList() {
  return BRAND_MODEL_FORMATS.map((format) => format.toUpperCase()).join(", ");
}

export function readableFileSize(bytes: number) {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}
