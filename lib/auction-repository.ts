import "server-only";

import type { AuctionSnapshot, PlaceBidResult, SpotSize } from "@/lib/auction";
import { getAuctionTable, getPlaceBidFunction } from "@/lib/database-names";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

type SpotRow = {
  id: number;
  name: string;
  size: SpotSize;
  dimensions: string;
  current_bidder_name: string;
  current_bid_cents: number;
  min_increment_cents: number;
  bid_count: number;
  current_logo_url: string | null;
  current_website: string | null;
};

type BidRow = {
  id: string;
  spot_id: number;
  amount_cents: number;
  bidder_name: string;
  created_at: string;
};

type PlaceBidRow = {
  accepted: boolean;
  reason: PlaceBidResult["reason"];
  current_bid_cents: number;
  minimum_next_bid_cents: number;
  current_bidder_name: string;
  bid_count: number;
  bid_id: string | null;
};

export type PlaceBidInput = {
  spotId: number;
  amountCents: number;
  brandName: string;
  email: string;
  website: string | null;
  xHandle: string | null;
  logoStoragePath: string | null;
  idempotencyKey: string;
};

function formatTimeAgo(timestamp: string) {
  const seconds = Math.max(1, Math.floor((Date.now() - new Date(timestamp).getTime()) / 1000));
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export async function getAuctionSnapshot(): Promise<AuctionSnapshot> {
  const supabase = getSupabaseAdmin();
  const [spotsResult, bidsResult] = await Promise.all([
    supabase
      .from(getAuctionTable("spots"))
      .select("id,name,size,dimensions,current_bidder_name,current_bid_cents,min_increment_cents,bid_count,current_logo_url,current_website")
      .order("current_bid_cents", { ascending: false }),
    supabase
      .from(getAuctionTable("bids"))
      .select("id,spot_id,amount_cents,bidder_name,created_at")
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  if (spotsResult.error) throw spotsResult.error;
  if (bidsResult.error) throw bidsResult.error;

  const spots = (spotsResult.data as SpotRow[]).map((spot) => {
    const hasBid = spot.bid_count > 0;
    const openingBidCents = spot.current_bid_cents + spot.min_increment_cents;

    return {
      id: spot.id,
      name: spot.name,
      size: spot.size,
      dimensions: spot.dimensions,
      holder: hasBid ? spot.current_bidder_name : "",
      bid: (hasBid ? spot.current_bid_cents : openingBidCents) / 100,
      minBid: openingBidCents / 100,
      bids: spot.bid_count,
      ...(hasBid && spot.current_logo_url ? { logo: spot.current_logo_url } : {}),
      ...(hasBid && spot.current_website ? { website: spot.current_website } : {}),
    };
  });

  const history = (bidsResult.data as BidRow[]).map((bid) => ({
    id: bid.id,
    brand: bid.bidder_name,
    spot: bid.spot_id,
    amount: bid.amount_cents / 100,
    time: formatTimeAgo(bid.created_at),
  }));

  return { spots, history };
}

export async function placeBid(input: PlaceBidInput): Promise<PlaceBidResult> {
  const supabase = getSupabaseAdmin();
  const { data, error } = await supabase.rpc(getPlaceBidFunction(), {
    p_spot_id: input.spotId,
    p_amount_cents: input.amountCents,
    p_bidder_name: input.brandName,
    p_bidder_email: input.email,
    p_website: input.website,
    p_x_handle: input.xHandle,
    p_logo_storage_path: input.logoStoragePath,
    p_idempotency_key: input.idempotencyKey,
  });

  if (error) throw error;

  const row = (Array.isArray(data) ? data[0] : data) as PlaceBidRow | undefined;
  if (!row) throw new Error("The database returned no result for the bid.");

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
