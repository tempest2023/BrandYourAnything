import "server-only";

import type { BidHistoryItem, Spot, SpotSize } from "@/lib/auction";
import type { CampaignAssetType } from "@/lib/brand-model";
import {
  getBrandModelBucket,
  getCampaignAssetTable,
  getCreateLaptopFunction,
  getLaptopMediaBucket,
  getLaptopTable,
  getLogoBucket,
  getPlaceLaptopBidFunction,
} from "@/lib/database-names";
import type {
  CreateLaptopInput,
  CreateLaptopResult,
  LaptopBidResult,
  LaptopSnapshot,
} from "@/lib/laptop";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type LaptopRow = {
  id: string;
  slug: string;
  owner_name: string;
  title: string;
  tagline: string;
  story: string;
  laptop_model: string;
  goal_cents: number;
  auction_closes_at: string;
  photo_storage_path: string | null;
  created_at: string;
};

type LaptopSpotRow = {
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
};

type LaptopBidRow = {
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

type CreateLaptopRow = {
  accepted: boolean;
  reason: CreateLaptopResult["reason"];
  laptop_id: string | null;
  laptop_slug: string;
};

type PlaceLaptopBidRow = {
  accepted: boolean;
  reason: LaptopBidResult["reason"];
  current_bid_cents: number;
  minimum_next_bid_cents: number;
  current_bidder_name: string;
  bid_count: number;
  bid_id: string | null;
};

export type PlaceLaptopBidInput = {
  slug: string;
  spotPosition: number;
  amountCents: number;
  brandName: string;
  email: string;
  website: string | null;
  xHandle: string | null;
  logoStoragePath: string | null;
  idempotencyKey: string;
};

export type AttachCampaignAssetInput = {
  laptopId: string;
  assetType: CampaignAssetType;
  assetName: string;
  modelStoragePath: string | null;
  modelFileName: string | null;
  idempotencyKey: string;
};

const ANYTHING_SPOTS = [
  ["Front hero", "Hero placement"],
  ["Upper feature", "Hero placement"],
  ["Rear hero", "Hero placement"],
  ["Left profile", "Detail placement"],
  ["Centre left", "Detail placement"],
  ["Centre right", "Detail placement"],
  ["Right profile", "Detail placement"],
  ["Lower left", "Profile placement"],
  ["Lower centre", "Profile placement"],
  ["Creator's choice", "Profile placement"],
] as const;

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

export async function getLaptopSnapshot(slug: string): Promise<LaptopSnapshot | null> {
  const supabase = getSupabaseAdmin();
  const { data: laptopData, error: laptopError } = await supabase
    .from(getLaptopTable("laptops"))
    .select("id,slug,owner_name,title,tagline,story,laptop_model,goal_cents,auction_closes_at,photo_storage_path,created_at")
    .eq("slug", slug.toLowerCase())
    .eq("status", "published")
    .maybeSingle();

  if (laptopError) throw laptopError;
  if (!laptopData) return null;
  const laptop = laptopData as LaptopRow;

  const [spotsResult, bidsResult, assetResult, photoUrl] = await Promise.all([
    supabase
      .from(getLaptopTable("laptop_spots"))
      .select("id,position,name,size,dimensions,opening_bid_cents,min_increment_cents,current_bid_cents,current_bidder_name,current_logo_storage_path,current_website,bid_count")
      .eq("laptop_id", laptop.id)
      .order("position", { ascending: true }),
    supabase
      .from(getLaptopTable("laptop_bids"))
      .select("id,spot_id,amount_cents,bidder_name,created_at")
      .eq("laptop_id", laptop.id)
      .order("created_at", { ascending: false })
      .limit(20),
    supabase
      .from(getCampaignAssetTable())
      .select("laptop_id,asset_type,asset_name,model_storage_path,model_file_name,idempotency_key")
      .eq("laptop_id", laptop.id)
      .maybeSingle(),
    signStoragePath(getLaptopMediaBucket(), laptop.photo_storage_path),
  ]);

  if (spotsResult.error) throw spotsResult.error;
  if (bidsResult.error) throw bidsResult.error;
  if (assetResult.error) throw assetResult.error;

  const asset = assetResult.data as CampaignAssetRow | null;
  const assetType: CampaignAssetType = asset?.asset_type === "anything" ? "anything" : "laptop";
  const assetName = asset?.asset_name || laptop.laptop_model;
  const modelUrl = asset?.model_storage_path
    ? await signStoragePath(getBrandModelBucket(), asset.model_storage_path)
    : undefined;

  const spotRows = spotsResult.data as LaptopSpotRow[];
  const logoUrls = await Promise.all(
    spotRows.map((spot) => signStoragePath(getLogoBucket(), spot.current_logo_storage_path)),
  );
  const spots: Spot[] = spotRows.map((spot, index) => {
    const hasBid = spot.current_bid_cents !== null && spot.bid_count > 0;
    const anythingSpot = assetType === "anything" ? ANYTHING_SPOTS[spot.position - 1] : undefined;
    return {
      id: spot.position,
      name: anythingSpot?.[0] || spot.name,
      size: spot.size,
      dimensions: anythingSpot?.[1] || spot.dimensions,
      holder: hasBid ? spot.current_bidder_name || "" : "",
      bid: (hasBid ? spot.current_bid_cents! : spot.opening_bid_cents) / 100,
      minBid: (hasBid
        ? spot.current_bid_cents! + spot.min_increment_cents
        : spot.opening_bid_cents) / 100,
      bids: spot.bid_count,
      ...(logoUrls[index] ? { logo: logoUrls[index] } : {}),
      ...(hasBid && spot.current_website ? { website: spot.current_website } : {}),
    };
  });

  const positionBySpotId = new Map(spotRows.map((spot) => [spot.id, spot.position]));
  const history: BidHistoryItem[] = (bidsResult.data as LaptopBidRow[]).map((bid) => ({
    id: bid.id,
    brand: bid.bidder_name,
    spot: positionBySpotId.get(bid.spot_id) ?? 0,
    amount: bid.amount_cents / 100,
    createdAt: bid.created_at,
  }));

  return {
    campaign: {
      slug: laptop.slug,
      title: laptop.title,
      tagline: laptop.tagline,
      story: laptop.story,
      laptopModel: laptop.laptop_model,
      assetType,
      assetName,
      ownerName: laptop.owner_name,
      goal: laptop.goal_cents / 100,
      closesAt: laptop.auction_closes_at,
      createdAt: laptop.created_at,
      ...(photoUrl ? { photoUrl } : {}),
      ...(modelUrl ? { modelUrl } : {}),
      ...(asset?.model_file_name ? { modelFileName: asset.model_file_name } : {}),
    },
    spots,
    history,
  };
}

export async function attachCampaignAsset(input: AttachCampaignAssetInput) {
  const supabase = getSupabaseAdmin();
  const row = {
    laptop_id: input.laptopId,
    asset_type: input.assetType,
    asset_name: input.assetName,
    model_storage_path: input.modelStoragePath,
    model_file_name: input.modelFileName,
    idempotency_key: input.idempotencyKey,
  };
  const { error: insertError } = await supabase
    .from(getCampaignAssetTable())
    .upsert(row, { onConflict: "laptop_id", ignoreDuplicates: true });
  if (insertError) throw insertError;

  const { data, error } = await supabase
    .from(getCampaignAssetTable())
    .select("laptop_id,asset_type,asset_name,model_storage_path,model_file_name,idempotency_key")
    .eq("laptop_id", input.laptopId)
    .single();
  if (error) throw error;
  const stored = data as CampaignAssetRow;
  const matches = stored.idempotency_key === input.idempotencyKey
    && stored.asset_type === input.assetType
    && stored.asset_name === input.assetName
    && stored.model_storage_path === input.modelStoragePath
    && stored.model_file_name === input.modelFileName;
  if (!matches) throw new Error("The campaign asset conflicts with an existing idempotent request.");
}

export async function createLaptop(input: CreateLaptopInput): Promise<CreateLaptopResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(getCreateLaptopFunction(), {
    p_slug: input.slug,
    p_owner_name: input.ownerName,
    p_owner_email: input.ownerEmail,
    p_title: input.title,
    p_tagline: input.tagline,
    p_story: input.story,
    p_laptop_model: input.laptopModel,
    p_goal_cents: input.goalCents,
    p_auction_closes_at: input.auctionClosesAt,
    p_photo_storage_path: input.photoStoragePath,
    p_small_opening_bid_cents: input.smallOpeningBidCents,
    p_medium_opening_bid_cents: input.mediumOpeningBidCents,
    p_large_opening_bid_cents: input.largeOpeningBidCents,
    p_min_increment_cents: input.minIncrementCents,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as CreateLaptopRow | undefined;
  if (!row) throw new Error("The database returned no result for laptop creation.");
  return {
    accepted: row.accepted,
    reason: row.reason,
    laptopId: row.laptop_id,
    slug: row.laptop_slug,
  };
}

export async function placeLaptopBid(input: PlaceLaptopBidInput): Promise<LaptopBidResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(getPlaceLaptopBidFunction(), {
    p_laptop_slug: input.slug,
    p_spot_position: input.spotPosition,
    p_amount_cents: input.amountCents,
    p_bidder_name: input.brandName,
    p_bidder_email: input.email,
    p_website: input.website,
    p_x_handle: input.xHandle,
    p_logo_storage_path: input.logoStoragePath,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as PlaceLaptopBidRow | undefined;
  if (!row) throw new Error("The database returned no result for the laptop bid.");
  return {
    accepted: row.accepted,
    reason: row.reason,
    currentBid: row.current_bid_cents / 100,
    minimumNextBid: row.minimum_next_bid_cents / 100,
    currentBidderName: row.current_bidder_name,
    bidCount: row.bid_count,
    bidId: row.bid_id,
  };
}
