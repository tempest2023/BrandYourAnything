import "server-only";

import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export class PublishingAuthenticationError extends Error {
  status: 401;

  constructor(message: string) {
    super(message);
    this.name = "PublishingAuthenticationError";
    this.status = 401;
  }
}

const MANAGER_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw new PublishingAuthenticationError("Sign in before publishing.");
  }
  return match[1];
}

function metadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

async function requireUser(request: Request) {
  const token = getBearerToken(request);
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);

  if (error || !data.user) {
    throw new PublishingAuthenticationError("Your session expired. Sign in again to publish.");
  }

  return data.user;
}

export function getOwnerIdentity(user: User) {
  const metadata = user.user_metadata as Record<string, unknown>;
  const handle = metadataString(metadata, ["user_name", "preferred_username", "username"])
    .replace(/^@/, "");
  const displayName = metadataString(metadata, ["full_name", "name", "display_name", "nickname"]);
  const email = user.email?.trim().toLowerCase() ?? "";
  const emailName = email.split("@", 1)[0]?.replace(/[._-]+/g, " ").trim() ?? "";
  const candidateName = displayName || (handle ? `@${handle}` : "") || emailName;
  const ownerName = candidateName.length >= 2
    ? candidateName.slice(0, 80)
    : `Creator ${user.id.slice(0, 8)}`;
  const ownerEmail = email || `user-${user.id}@auth.brand-anything.vercel.app`;

  return { ownerEmail, ownerName };
}

export async function getPublishingOwner(request: Request) {
  if (request.headers.has("authorization")) {
    // Brand Anything intentionally shares the Supabase Auth user pool with the
    // other applications in this Supabase project. A valid project user does
    // not need a second app-specific membership record.
    return getOwnerIdentity(await requireUser(request));
  }

  const managerKey = request.headers.get("x-lid-manager-key")?.trim() ?? "";
  if (!MANAGER_KEY_PATTERN.test(managerKey)) {
    throw new PublishingAuthenticationError(
      "Publish from the browser where you created this auction, or sign in.",
    );
  }

  const fingerprint = createHash("sha256").update(managerKey).digest("hex").slice(0, 32);
  return {
    ownerName: "Campaign owner",
    ownerEmail: `lid-${fingerprint}@auth.brand-anything.vercel.app`,
  };
}
