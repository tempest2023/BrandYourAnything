import "server-only";

import { createHash } from "node:crypto";

import type { User } from "@supabase/supabase-js";

import { getSupabaseAdmin } from "@/lib/supabase-admin";

export class XAuthenticationError extends Error {
  status: 401 | 403;

  constructor(message: string, status: 401 | 403) {
    super(message);
    this.name = "XAuthenticationError";
    this.status = status;
  }
}

const LEGACY_MANAGER_KEY_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MANAGER_RECOVERY_CODE_PATTERN = /^ba_mgr_[A-Za-z0-9_-]{43}$/;

export type AuctionOwnerCredential = {
  kind: "x" | "manager";
  ownerUserId: string | null;
  managerKeyHash: string | null;
  managerKeyHashCandidates: string[];
  ownerEmail: string;
  ownerName: string;
};

function getBearerToken(request: Request) {
  const authorization = request.headers.get("authorization");
  const match = authorization?.match(/^Bearer\s+(\S+)$/i);
  if (!match) {
    throw new XAuthenticationError("Sign in with X before publishing.", 401);
  }
  return match[1];
}

function userHasXIdentity(user: User) {
  const providers = user.app_metadata.providers;
  return user.app_metadata.provider === "x"
    || user.app_metadata.provider === "twitter"
    || (Array.isArray(providers) && (providers.includes("x") || providers.includes("twitter")))
    || user.identities?.some((identity) => identity.provider === "x" || identity.provider === "twitter") === true;
}

function metadataString(metadata: Record<string, unknown>, keys: string[]) {
  for (const key of keys) {
    const value = metadata[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return "";
}

export async function requireXUser(request: Request) {
  const token = getBearerToken(request);
  const { data, error } = await getSupabaseAdmin().auth.getUser(token);

  if (error || !data.user) {
    throw new XAuthenticationError("Your X session expired. Sign in again to publish.", 401);
  }
  if (!userHasXIdentity(data.user)) {
    throw new XAuthenticationError("This listing must be published with an X account.", 403);
  }

  return data.user;
}

export function getXOwnerIdentity(user: User): AuctionOwnerCredential {
  const metadata = user.user_metadata as Record<string, unknown>;
  const handle = metadataString(metadata, ["user_name", "preferred_username", "username"])
    .replace(/^@/, "");
  const displayName = metadataString(metadata, ["full_name", "name", "display_name", "nickname"]);
  const candidateName = displayName || (handle ? `@${handle}` : "");
  const ownerName = candidateName.length >= 2
    ? candidateName.slice(0, 80)
    : `X user ${user.id.slice(0, 8)}`;
  const ownerEmail = user.email?.trim().toLowerCase()
    || `x-${user.id}@auth.brand-anything.vercel.app`;

  return {
    kind: "x",
    ownerUserId: user.id,
    managerKeyHash: null,
    managerKeyHashCandidates: [],
    ownerEmail,
    ownerName,
  };
}

export function getManagerCredentialFromValue(managerKeyInput: string): AuctionOwnerCredential {
  const managerKey = managerKeyInput.trim();
  if (!LEGACY_MANAGER_KEY_PATTERN.test(managerKey) && !MANAGER_RECOVERY_CODE_PATTERN.test(managerKey)) {
    throw new XAuthenticationError(
      "Use the browser or recovery code that owns this auction, or sign in with X.",
      401,
    );
  }

  const fullHash = createHash("sha256").update(managerKey).digest("hex");
  const legacyHash = fullHash.slice(0, 32);
  return {
    kind: "manager",
    ownerUserId: null,
    managerKeyHash: fullHash,
    managerKeyHashCandidates: [fullHash, legacyHash],
    ownerName: "Campaign owner",
    ownerEmail: `lid-${legacyHash}@auth.brand-anything.vercel.app`,
  };
}

export function getManagerCredential(request: Request): AuctionOwnerCredential {
  return getManagerCredentialFromValue(request.headers.get("x-lid-manager-key") ?? "");
}

export async function getXOwner(request: Request) {
  return getXOwnerIdentity(await requireXUser(request));
}

export async function getPublishingOwner(request: Request) {
  return request.headers.has("authorization")
    ? getXOwner(request)
    : getManagerCredential(request);
}
