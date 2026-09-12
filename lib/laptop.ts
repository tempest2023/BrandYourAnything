import type { AuctionSnapshot, PlaceBidResult } from "@/lib/auction";
import type { CampaignAssetType } from "@/lib/brand-model";
import type { SpotLayoutItem } from "@/lib/surface-spots";

export type LaptopCampaign = {
  slug: string;
  status: "published" | "closed";
  isDefault: boolean;
  title: string;
  tagline: string;
  story: string;
  laptopModel: string;
  assetType: CampaignAssetType;
  assetName: string;
  ownerName: string;
  goal: number;
  closesAt: string;
  createdAt: string;
  paymentsEnabled: boolean;
  photoUrl?: string;
  modelUrl?: string;
  modelFileName?: string;
};

export type LaptopSnapshot = AuctionSnapshot & {
  campaign: LaptopCampaign;
};

export type CreateLaptopInput = {
  slug: string;
  ownerUserId: string | null;
  managerKeyHash: string | null;
  ownerName: string;
  ownerEmail: string;
  title: string;
  tagline: string;
  story: string;
  laptopModel: string;
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

export type CreateLaptopResult = {
  accepted: boolean;
  reason: "created" | "already_processed" | "slug_taken" | "rate_limited" | "idempotency_conflict";
  laptopId: string | null;
  slug: string;
};

export type LaptopBidResult = Omit<PlaceBidResult, "reason"> & {
  reason: PlaceBidResult["reason"] | "campaign_not_found";
};

export type LaptopBidPaymentStatus =
  | "pending"
  | "paid"
  | "accepted"
  | "refund_pending"
  | "refunded"
  | "expired"
  | "failed";
