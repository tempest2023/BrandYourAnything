import { createHash } from "node:crypto";

import { getLaptopMediaBucket } from "@/lib/database-names";
import { createLaptop, getLaptopSnapshot } from "@/lib/laptop-repository";
import { LaptopValidationError, parseLaptopForm } from "@/lib/laptop-validation";
import { getSupabaseAdmin, isSupabaseConfigured } from "@/lib/supabase-admin";
import { getXOwnerIdentity, requireXUser, XAuthenticationError } from "@/lib/x-auth";

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
    const user = await requireXUser(request);
    const owner = getXOwnerIdentity(user);
    const formData = await request.formData();
    formData.set("ownerName", owner.ownerName);
    formData.set("ownerEmail", owner.ownerEmail);
    const input = parseLaptopForm(formData);
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
    const snapshot = await getLaptopSnapshot(result.slug).catch((error) => {
      console.error("Laptop was created but its first snapshot could not be loaded", error);
      return null;
    });

    return Response.json(
      { result, snapshot, location: `/laptop/${result.slug}` },
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
