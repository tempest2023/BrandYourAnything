import type { AuctionSnapshot, PlaceBidResult } from "@/lib/auction";

export type LaptopCampaign = {
  slug: string;
  title: string;
  tagline: string;
  story: string;
  laptopModel: string;
  ownerName: string;
  goal: number;
  closesAt: string;
  createdAt: string;
  photoUrl?: string;
};

export type LaptopSnapshot = AuctionSnapshot & {
  campaign: LaptopCampaign;
};

export type CreateLaptopInput = {
  slug: string;
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
