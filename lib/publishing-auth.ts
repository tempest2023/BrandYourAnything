import "server-only";

import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type AuctionOwnerCredential = {
  kind: "auth" | "manager";
  ownerUserId: string | null;
  managerKeyHash: string | null;
  managerKeyHashCandidates: string[];
  ownerEmail: string;
  ownerName: string;
};

export class PublishingAuthenticationError extends Error {
  status: 401;

  constructor(message: string) {
    super(message);
    this.name = "PublishingAuthenticationError";
    this.status = 401;
  }
}

const MANAGER_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGER_RECOVERY_CODE_PATTERN = /^ba_mgr_[A-Za-z0-9_-]{43}$/;

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

function ownerCredential(user: User): AuctionOwnerCredential {
  const identity = getOwnerIdentity(user);
  return {
    kind: "auth",
    ownerUserId: user.id,
    managerKeyHash: null,
    managerKeyHashCandidates: [],
    ...identity,
  };
}

export function getManagerCredentialFromValue(value: string): AuctionOwnerCredential {
  const managerKey = value.trim();
  if (!MANAGER_KEY_PATTERN.test(managerKey) && !MANAGER_RECOVERY_CODE_PATTERN.test(managerKey)) {
    throw new PublishingAuthenticationError("Sign in before managing this auction.");
  }
  const fullHash = createHash("sha256").update(managerKey).digest("hex");
  const legacyHash = fullHash.slice(0, 32);
  return {
    kind: "manager",
    ownerUserId: null,
    managerKeyHash: fullHash,
    managerKeyHashCandidates: [fullHash, legacyHash],
    ownerName: "Campaign owner",
    ownerEmail: `auction-${legacyHash}@auth.brand-anything.vercel.app`,
  };
}

export function getManagerCredential(request: Request) {
  return getManagerCredentialFromValue(
    request.headers.get("x-auction-manager-key")
      || request.headers.get("x-lid-manager-key")
      || "",
  );
}

export async function getPublishingOwnerCredential(request: Request): Promise<AuctionOwnerCredential> {
  if (request.headers.has("authorization")) {
    return ownerCredential(await requireUser(request));
  }
  return getManagerCredential(request);
}

export async function getPublishingOwner(request: Request) {
  const owner = await getPublishingOwnerCredential(request);
  return { ownerName: owner.ownerName, ownerEmail: owner.ownerEmail };
}
