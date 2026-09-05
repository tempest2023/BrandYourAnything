import type { AuctionSnapshot, PlaceBidResult } from "@/lib/auction";
import type { CampaignAssetType } from "@/lib/brand-model";
import type { SpotLayoutItem } from "@/lib/surface-spots";

export type AuctionCampaign = {
  slug: string;
  title: string;
  tagline: string;
  story: string;
  objectName: string;
  assetType: CampaignAssetType;
  assetName: string;
  ownerName: string;
  goal: number;
  closesAt: string;
  createdAt: string;
  photoUrl?: string;
  modelUrl?: string;
  modelFileName?: string;
};

export type AuctionCampaignSnapshot = AuctionSnapshot & {
  campaign: AuctionCampaign;
};

export type CreateAuctionInput = {
  slug: string;
  ownerName: string;
  ownerEmail: string;
  title: string;
  tagline: string;
  story: string;
  objectName: string;
  goalCents: number;
  auctionClosesAt: string;
  photoStoragePath: string | null;
  smallOpeningBidCents: number;
  mediumOpeningBidCents: number;
  largeOpeningBidCents: number;
  minIncrementCents: number;
  spotLayout: SpotLayoutItem[];
  idempotencyKey: string;
};

export type CreateAuctionResult = {
  accepted: boolean;
  reason: "created" | "already_processed" | "slug_taken" | "rate_limited" | "idempotency_conflict";
  auctionId: string | null;
  slug: string;
};

export type AuctionBidResult = Omit<PlaceBidResult, "reason"> & {
  reason: PlaceBidResult["reason"] | "campaign_not_found";
};
