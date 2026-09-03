import "server-only";

export const MAX_LAPTOP_PHOTO_BYTES = 5 * 1024 * 1024;

const ACCEPTED_PHOTO_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SLUG_PATTERN = /^[a-z0-9](?:[a-z0-9_-]{1,46}[a-z0-9_-])$/;

export class LaptopValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LaptopValidationError";
  }
}

export type ParsedLaptopForm = {
  slug: string;
  ownerName: string;
  ownerEmail: string;
  title: string;
  tagline: string;
  story: string;
  laptopModel: string;
  goalCents: number;
  auctionClosesAt: string;
  smallOpeningBidCents: number;
  mediumOpeningBidCents: number;
  largeOpeningBidCents: number;
  minIncrementCents: number;
  idempotencyKey: string;
  photo: File | null;
};

function requiredText(formData: FormData, key: string, minLength: number, maxLength: number) {
  const value = formData.get(key);
  if (typeof value !== "string" || !value.trim()) {
    throw new LaptopValidationError(`Please enter ${key}.`);
  }
  const normalized = value.trim();
  if (normalized.length < minLength || normalized.length > maxLength) {
    throw new LaptopValidationError(`${key} must be between ${minLength} and ${maxLength} characters.`);
  }
  return normalized;
}

function cents(formData: FormData, key: string, minimum: number, maximum: number) {
  const value = Number(requiredText(formData, key, 1, 12));
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new LaptopValidationError(`${key} is outside the allowed range.`);
  }
  return value;
}

export function parseLaptopForm(formData: FormData): ParsedLaptopForm {
  const slug = requiredText(formData, "slug", 3, 48).toLowerCase();
  const ownerName = requiredText(formData, "ownerName", 2, 80);
  const ownerEmail = requiredText(formData, "ownerEmail", 3, 254).toLowerCase();
  const title = requiredText(formData, "title", 3, 80);
  const tagline = requiredText(formData, "tagline", 3, 160);
  const story = requiredText(formData, "story", 20, 1200);
  const laptopModel = requiredText(formData, "laptopModel", 2, 100);
  const idempotencyKey = requiredText(formData, "idempotencyKey", 36, 36).toLowerCase();
  const goalCents = cents(formData, "goalCents", 100, 100_000_000_000);
  const smallOpeningBidCents = cents(formData, "smallOpeningBidCents", 100, 100_000_000_000);
  const mediumOpeningBidCents = cents(formData, "mediumOpeningBidCents", 100, 100_000_000_000);
  const largeOpeningBidCents = cents(formData, "largeOpeningBidCents", 100, 100_000_000_000);
  const minIncrementCents = cents(formData, "minIncrementCents", 100, 1_000_000);
  const auctionClosesAtInput = requiredText(formData, "auctionClosesAt", 10, 40);
  const auctionClosesAtDate = new Date(auctionClosesAtInput);
  const minimumClose = Date.now() + 60 * 60 * 1000;
  const maximumClose = Date.now() + 90 * 24 * 60 * 60 * 1000;

  if (!SLUG_PATTERN.test(slug)) {
    throw new LaptopValidationError("URL slug can use lowercase letters, numbers, and single hyphens only.");
  }
  if (!EMAIL_PATTERN.test(ownerEmail)) {
    throw new LaptopValidationError("Owner email needs a valid address, for example you@company.com.");
  }
  if (!UUID_PATTERN.test(idempotencyKey)) {
    throw new LaptopValidationError("The creation request is missing a valid idempotency key.");
  }
  if (!Number.isFinite(auctionClosesAtDate.getTime())
    || auctionClosesAtDate.getTime() <= minimumClose
    || auctionClosesAtDate.getTime() > maximumClose) {
    throw new LaptopValidationError("Auction end must be between one hour and 90 days from now.");
  }

  const photoValue = formData.get("photo");
  const photo = photoValue instanceof File && photoValue.size > 0 ? photoValue : null;
  if (photo && photo.size > MAX_LAPTOP_PHOTO_BYTES) {
    throw new LaptopValidationError("Laptop photos must be 5 MB or smaller.");
  }
  if (photo && !ACCEPTED_PHOTO_TYPES.has(photo.type)) {
    throw new LaptopValidationError("Laptop photos must be PNG, JPG, or WEBP.");
  }

  return {
    slug,
    ownerName,
    ownerEmail,
    title,
    tagline,
    story,
    laptopModel,
    goalCents,
    auctionClosesAt: auctionClosesAtDate.toISOString(),
    smallOpeningBidCents,
    mediumOpeningBidCents,
    largeOpeningBidCents,
    minIncrementCents,
    idempotencyKey,
    photo,
  };
}
