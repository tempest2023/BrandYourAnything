import "server-only";

import type { BidHistoryItem, Spot, SpotSize } from "@/lib/auction";
import type { CampaignAssetType } from "@/lib/brand-model";
import {
  getBrandModelBucket,
  getCampaignAssetTable,
  getCampaignTable,
  getPublishOwnedAuctionFunction,
  getAuctionMediaBucket,
  getLogoBucket,
} from "@/lib/database-names";
import type {
  AuctionCampaignSnapshot,
  CreateAuctionInput,
  CreateAuctionResult,
} from "@/lib/campaign-auction";
import { getPresetModelFromStoragePath } from "@/lib/preset-models";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import { isStripeConfigured } from "@/lib/stripe";
import { AuctionValidationError } from "@/lib/auction-validation";
import type { SpotLayoutItem } from "@/lib/surface-spots";

type CampaignRow = {
  id: string;
  slug: string;
  status: "published" | "closed";
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
  owner_name: string;
  title: string;
  tagline: string;
  story: string;
  laptop_model: string;
  goal_cents: number;
  auction_closes_at: string;
  photo_storage_path: string | null;
  created_at: string;
  spot_layout: SpotLayoutItem[] | null;
};

type CampaignSpotRow = {
  id: string;
  position: number;
  name: string;
  size: SpotSize;
  dimensions: string;
  opening_bid_cents: number;
  min_increment_cents: number;
  current_bid_cents: number | null;
  current_bidder_name: string | null;
  current_logo_storage_path: string | null;
  current_website: string | null;
  bid_count: number;
  surface_position: [number, number, number] | null;
  surface_normal: [number, number, number] | null;
};

type CampaignBidRow = {
  id: string;
  spot_id: string;
  amount_cents: number;
  bidder_name: string;
  created_at: string;
};

type CampaignAssetRow = {
  laptop_id: string;
  asset_type: CampaignAssetType;
  asset_name: string;
  model_storage_path: string | null;
  model_file_name: string | null;
  idempotency_key: string;
};

type CreateAuctionRow = {
  accepted: boolean;
  reason: CreateAuctionResult["reason"];
  auction_id: string | null;
  auction_slug: string;
};

async function signStoragePath(bucket: string, path: string | null) {
  if (!path) return undefined;
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 60 * 60);
  if (error) {
    console.error("Failed to sign public campaign media", { bucket, path, message: error.message });
    return undefined;
  }
  return data.signedUrl;
}

export async function getAuctionSnapshot(slug: string): Promise<AuctionCampaignSnapshot | null> {
  const supabase = getSupabaseAdmin();
  const { data: campaignData, error: campaignError } = await supabase
    .from(getCampaignTable("campaigns"))
    .select("id,slug,status,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled,owner_name,title,tagline,story,laptop_model,goal_cents,auction_closes_at,photo_storage_path,created_at,spot_layout")
    .eq("slug", slug.toLowerCase())
    .in("status", ["published", "closed"])
    .maybeSingle();

  if (campaignError) throw campaignError;
  if (!campaignData) return null;
  const campaign = campaignData as CampaignRow;

  const [spotsResult, bidsResult, assetResult, photoUrl] = await Promise.all([
    supabase
      .from(getCampaignTable("campaign_spots"))
      .select("id,position,name,size,dimensions,opening_bid_cents,min_increment_cents,current_bid_cents,current_bidder_name,current_logo_storage_path,current_website,bid_count,surface_position,surface_normal")
      .eq("laptop_id", campaign.id)
      .order("position", { ascending: true }),
    supabase
      .from(getCampaignTable("campaign_bids"))
      .select("id,spot_id,amount_cents,bidder_name,created_at")
      .eq("laptop_id", campaign.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from(getCampaignAssetTable())
      .select("laptop_id,asset_type,asset_name,model_storage_path,model_file_name,idempotency_key")
      .eq("laptop_id", campaign.id)
      .maybeSingle(),
    signStoragePath(getAuctionMediaBucket(), campaign.photo_storage_path),
  ]);

  if (spotsResult.error) throw spotsResult.error;
  if (bidsResult.error) throw bidsResult.error;
  if (assetResult.error) throw assetResult.error;

  const asset = assetResult.data as CampaignAssetRow | null;
  const assetType: CampaignAssetType = asset?.asset_type === "anything" ? "anything" : "laptop";
  const assetName = asset?.asset_name || campaign.laptop_model;
  const presetModel = getPresetModelFromStoragePath(asset?.model_storage_path);
  const modelUrl = presetModel?.publicPath || (asset?.model_storage_path
    ? await signStoragePath(getBrandModelBucket(), asset.model_storage_path)
    : undefined);

  const spotRows = spotsResult.data as CampaignSpotRow[];
  const logoUrls = await Promise.all(
    spotRows.map((spot) => signStoragePath(getLogoBucket(), spot.current_logo_storage_path)),
  );
  const spots: Spot[] = spotRows.map((spot, index) => {
    const hasBid = spot.current_bid_cents !== null && spot.bid_count > 0;
    return {
      id: spot.position,
      name: spot.name,
      size: spot.size,
      dimensions: spot.dimensions,
      holder: hasBid ? spot.current_bidder_name || "" : "",
      bid: (hasBid ? spot.current_bid_cents! : spot.opening_bid_cents) / 100,
      minBid: (hasBid
        ? spot.current_bid_cents! + spot.min_increment_cents
        : spot.opening_bid_cents) / 100,
      bids: spot.bid_count,
      ...(assetType === "laptop" && campaign.spot_layout?.find((entry) => entry.id === spot.position)?.logoCover
        ? { logoCover: true as const } : {}),
      ...(logoUrls[index] ? { logo: logoUrls[index] } : {}),
      ...(logoUrls[index] && spot.current_logo_storage_path
        ? { logoKey: spot.current_logo_storage_path } : {}),
      ...(hasBid && spot.current_website ? { website: spot.current_website } : {}),
      ...(spot.surface_position ? { surfacePosition: spot.surface_position } : {}),
      ...(spot.surface_normal ? { surfaceNormal: spot.surface_normal } : {}),
    };
  });

  const positionBySpotId = new Map(spotRows.map((spot) => [spot.id, spot.position]));
  const history: BidHistoryItem[] = (bidsResult.data as CampaignBidRow[]).map((bid) => ({
    id: bid.id,
    brand: bid.bidder_name,
    spot: positionBySpotId.get(bid.spot_id) ?? 0,
    amount: bid.amount_cents / 100,
    createdAt: bid.created_at,
  }));

  return {
    campaign: {
      slug: campaign.slug,
      status: campaign.status,
      paymentsEnabled: isStripeConfigured() && Boolean(campaign.stripe_account_id)
        && campaign.stripe_charges_enabled && campaign.stripe_payouts_enabled,
      title: campaign.title,
      tagline: campaign.tagline,
      story: campaign.story,
      objectName: campaign.laptop_model,
      assetType,
      assetName,
      ownerName: campaign.owner_name,
      goal: campaign.goal_cents / 100,
      closesAt: campaign.auction_closes_at,
      createdAt: campaign.created_at,
      ...(photoUrl ? { photoUrl } : {}),
      ...(modelUrl ? { modelUrl } : {}),
      ...(asset?.model_file_name ? { modelFileName: asset.model_file_name } : {}),
      ...(asset?.idempotency_key ? { assetVersion: asset.idempotency_key } : {}),
    },
    spots,
    history,
  };
}

export async function createAuction(input: CreateAuctionInput): Promise<CreateAuctionResult> {
  const { ownerUserId, managerKeyHash, ...parameters } = input;
  const { data, error } = await getSupabaseAdmin().rpc(getPublishOwnedAuctionFunction(), {
    p_owner_user_id: ownerUserId ?? null,
    p_manager_key_hash: managerKeyHash ?? null,
    p_input: parameters,
  });
  if (error && ["22023", "23514", "23502", "22P02"].includes(error.code)) {
    throw new AuctionValidationError("The publication details are invalid.");
  }
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as CreateAuctionRow | undefined;
  if (!row) throw new Error("The database returned no result for auction publication.");
  return {
    accepted: row.accepted,
    reason: row.reason,
    auctionId: row.auction_id,
    slug: row.auction_slug,
  };
}
