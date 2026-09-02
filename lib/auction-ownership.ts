import "server-only";

import {
  getCampaignAssetTable,
  getClaimAuctionFunction,
  getLaptopTable,
} from "@/lib/database-names";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { AuctionOwnerCredential } from "@/lib/x-auth";

type OwnedCampaignRow = {
  id: string;
  slug: string;
  title: string;
  status: "published" | "closed";
  auction_closes_at: string;
  owner_user_id: string | null;
  manager_key_hash: string | null;
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  created_at: string;
};

export type OwnedAuctionSummary = {
  id: string;
  slug: string;
  title: string;
  status: "published" | "closed";
  closesAt: string;
  createdAt: string;
  claimedByX: boolean;
  browserRecoveryEnabled: boolean;
  stripeConnected: boolean;
  paymentsEnabled: boolean;
};

export type OwnedCampaignModelInput = {
  assetName: string;
  modelStoragePath: string;
  modelFileName: string;
  idempotencyKey: string;
};

const OWNER_COLUMNS = "id,slug,title,status,auction_closes_at,owner_user_id,manager_key_hash,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled,created_at";

function ownerMatches(row: OwnedCampaignRow, owner: AuctionOwnerCredential) {
  if (owner.ownerUserId && row.owner_user_id === owner.ownerUserId) return true;
  return Boolean(
    row.manager_key_hash
    && owner.managerKeyHashCandidates.includes(row.manager_key_hash),
  );
}

function toSummary(row: OwnedCampaignRow): OwnedAuctionSummary {
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    status: row.status,
    closesAt: row.auction_closes_at,
    createdAt: row.created_at,
    claimedByX: Boolean(row.owner_user_id),
    browserRecoveryEnabled: Boolean(row.manager_key_hash),
    stripeConnected: Boolean(row.stripe_account_id),
    paymentsEnabled: row.stripe_charges_enabled && row.stripe_payouts_enabled,
  };
}

export async function getOwnedAuction(slug: string, owner: AuctionOwnerCredential) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .select(OWNER_COLUMNS)
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  if (!data || !ownerMatches(data as OwnedCampaignRow, owner)) return null;
  return toSummary(data as OwnedCampaignRow);
}

export async function listXOwnedAuctions(owner: AuctionOwnerCredential) {
  if (!owner.ownerUserId) return [];
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .select(OWNER_COLUMNS)
    .eq("owner_user_id", owner.ownerUserId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return (data as OwnedCampaignRow[]).map(toSummary);
}

export async function claimAuctionForX(
  slug: string,
  manager: AuctionOwnerCredential,
  xOwner: AuctionOwnerCredential,
) {
  if (!manager.managerKeyHashCandidates.length || !xOwner.ownerUserId) return null;

  const { data: claimData, error: claimError } = await getSupabaseAdmin().rpc(
    getClaimAuctionFunction(),
    {
      p_slug: slug.toLowerCase(),
      p_manager_key_hashes: manager.managerKeyHashCandidates,
      p_owner_user_id: xOwner.ownerUserId,
      p_owner_name: xOwner.ownerName,
      p_owner_email: xOwner.ownerEmail,
    },
  );
  if (claimError) throw claimError;
  const result = (claimData as Array<{
    accepted: boolean;
    reason: "claimed" | "already_claimed" | "claimed_by_another_user" | "not_found";
    laptop_id: string | null;
  }>)[0];
  if (!result || result.reason === "not_found" || !result.laptop_id) return null;
  if (!result.accepted && result.reason === "claimed_by_another_user") {
    throw new Error("auction_claimed_by_another_user");
  }

  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .select(OWNER_COLUMNS)
    .eq("id", result.laptop_id)
    .single();
  if (error) throw error;
  return toSummary(data as OwnedCampaignRow);
}

export async function closeOwnedAuction(slug: string, owner: AuctionOwnerCredential) {
  const owned = await getOwnedAuction(slug, owner);
  if (!owned) return null;
  if (owned.status === "closed") return owned;

  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .update({ status: "closed", updated_at: new Date().toISOString() })
    .eq("id", owned.id)
    .eq("status", "published")
    .select(OWNER_COLUMNS)
    .single();
  if (error) throw error;
  return toSummary(data as OwnedCampaignRow);
}

export async function setAuctionRecoveryForX(
  slug: string,
  owner: AuctionOwnerCredential,
  managerKeyHash: string | null,
) {
  if (!owner.ownerUserId) return null;
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .update({ manager_key_hash: managerKeyHash, updated_at: new Date().toISOString() })
    .eq("slug", slug.toLowerCase())
    .eq("owner_user_id", owner.ownerUserId)
    .select(OWNER_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  return data ? toSummary(data as OwnedCampaignRow) : null;
}

export async function attachOwnedCampaignModel(
  slug: string,
  owner: AuctionOwnerCredential,
  input: OwnedCampaignModelInput,
) {
  const owned = await getOwnedAuction(slug, owner);
  if (!owned) return null;

  const supabase = getSupabaseAdmin();
  const { count: bidCount, error: bidError } = await supabase
    .from(getLaptopTable("laptop_bids"))
    .select("id", { count: "exact", head: true })
    .eq("laptop_id", owned.id);
  if (bidError) throw bidError;
  if ((bidCount ?? 0) > 0) throw new Error("auction_model_locked_by_bids");

  const { error } = await supabase
    .from(getCampaignAssetTable())
    .upsert({
      laptop_id: owned.id,
      asset_type: "anything",
      asset_name: input.assetName,
      model_storage_path: input.modelStoragePath,
      model_file_name: input.modelFileName,
      idempotency_key: input.idempotencyKey,
    }, { onConflict: "laptop_id" });
  if (error) throw error;
  return owned;
}
