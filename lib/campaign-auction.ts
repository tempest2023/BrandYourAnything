import type { AuctionSnapshot } from "@/lib/auction";
import type { CampaignAssetType } from "@/lib/brand-model";
import type { SpotLayoutItem } from "@/lib/surface-spots";

export type AuctionCampaign = {
  slug: string;
  status: "published" | "closed";
  paymentsEnabled: boolean;
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
  assetVersion?: string;
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
  assetType: CampaignAssetType;
  assetName: string;
  modelStoragePath: string | null;
  modelFileName: string | null;
  idempotencyKey: string;
  ownerUserId?: string | null;
  managerKeyHash?: string | null;
};

export type CreateAuctionResult = {
  accepted: boolean;
  reason: "created" | "already_processed" | "slug_taken" | "rate_limited" | "idempotency_conflict";
  auctionId: string | null;
  slug: string;
};
