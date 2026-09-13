import "server-only";
import { resolveDatabasePrefix } from "@/lib/environment-policy";

export type DatabasePrefix = "ba_dev" | "ba_prod";

export function getDatabasePrefix(): DatabasePrefix {
  return resolveDatabasePrefix(process.env);
}

export function getLogoBucket() {
  return `${getDatabasePrefix()}_bid_logos`;
}

export function getCampaignTable(name: "campaigns" | "campaign_spots" | "campaign_bids") {
  const legacyTable = {
    campaigns: "laptops",
    campaign_spots: "laptop_spots",
    campaign_bids: "laptop_bids",
  }[name];
  return `${getDatabasePrefix()}_${legacyTable}`;
}

export function getPublishOwnedAuctionFunction() {
  return `${getDatabasePrefix()}_publish_owned_auction`;
}

export function getAuctionMediaBucket() {
  return `${getDatabasePrefix()}_laptop_media`;
}

export function getBrandModelBucket() {
  return `${getDatabasePrefix()}_brand_models`;
}

export function getCampaignAssetTable() {
  return `${getDatabasePrefix()}_campaign_assets`;
}

// The database migrations predate the application-level auction rename. Keep
// these compatibility helpers private to the server-side ownership/payment
// adapters while all public routes use auction terminology.
export function getLaptopTable(name: "laptops" | "laptop_spots" | "laptop_bids") {
  return `${getDatabasePrefix()}_${name}`;
}

export function getClaimAuctionFunction() {
  return `${getDatabasePrefix()}_claim_auction`;
}

export function getLaptopBidPaymentTable() {
  return `${getDatabasePrefix()}_laptop_bid_payments`;
}

export function getSettleLaptopBidPaymentFunction() {
  return `${getDatabasePrefix()}_settle_laptop_bid_payment`;
}
