export const MAX_LOGO_BYTES = 2 * 1024 * 1024;

const ACCEPTED_LOGO_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "image/svg+xml"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export class BidValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BidValidationError";
  }
}

export type ParsedBidForm = {
  spotId: number;
  amountCents: number;
  brandName: string;
  email: string;
  website: string | null;
  xHandle: string | null;
  idempotencyKey: string;
  logo: File | null;
};

function requiredText(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new BidValidationError(`${key} is required.`);
  }

  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new BidValidationError(`${key} is too long.`);
  }
  return normalized;
}

function optionalText(formData: FormData, key: string, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) return null;
  const normalized = value.trim();
  if (normalized.length > maxLength) {
    throw new BidValidationError(`${key} is too long.`);
  }
  return normalized;
}

function normalizedWebsite(value: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    return url.toString();
  } catch {
    throw new BidValidationError("website must be a valid HTTP or HTTPS URL.");
  }
}

export function parseBidForm(formData: FormData): ParsedBidForm {
  const spotId = Number(requiredText(formData, "spotId", 2));
  const amountCents = Number(requiredText(formData, "amountCents", 12));
  const brandName = requiredText(formData, "brandName", 80);
  const email = requiredText(formData, "email", 254).toLowerCase();
  const website = normalizedWebsite(optionalText(formData, "website", 2048));
  const xHandle = optionalText(formData, "xHandle", 50);
  const idempotencyKey = requiredText(formData, "idempotencyKey", 36).toLowerCase();

  if (!Number.isInteger(spotId) || spotId < 1 || spotId > 16) {
    throw new BidValidationError("spotId must identify a valid sticker spot.");
  }
  if (!Number.isSafeInteger(amountCents) || amountCents < 1000 || amountCents > 100_000_000) {
    throw new BidValidationError("amountCents must be between $10 and $1,000,000.");
  }
  if (!EMAIL_PATTERN.test(email)) {
    throw new BidValidationError("email must be valid.");
  }
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new BidValidationError("idempotencyKey must be a UUID.");
  }

  const logoValue = formData.get("logo");
  const logo = logoValue instanceof File && logoValue.size > 0 ? logoValue : null;
  if (logo && logo.size > MAX_LOGO_BYTES) {
    throw new BidValidationError("Logo files must be 2 MB or smaller.");
  }
  if (logo && !ACCEPTED_LOGO_TYPES.has(logo.type)) {
    throw new BidValidationError("Logo files must be PNG, JPG, WEBP, or SVG.");
  }

  return { spotId, amountCents, brandName, email, website, xHandle, idempotencyKey, logo };
}
