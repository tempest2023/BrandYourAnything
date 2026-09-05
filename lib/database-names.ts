import "server-only";

const DATABASE_PREFIXES = ["ba_dev", "ba_prod"] as const;

export type DatabasePrefix = (typeof DATABASE_PREFIXES)[number];

export function getDatabasePrefix(): DatabasePrefix {
  const configured = process.env.SUPABASE_DATABASE_PREFIX;
  const fallback = process.env.VERCEL_ENV === "production" ? "ba_prod" : "ba_dev";
  const prefix = configured || fallback;

  if (!DATABASE_PREFIXES.includes(prefix as DatabasePrefix)) {
    throw new Error(
      `SUPABASE_DATABASE_PREFIX must be one of: ${DATABASE_PREFIXES.join(", ")}.`,
    );
  }

  return prefix as DatabasePrefix;
}

export function getAuctionTable(name: "spots" | "bids") {
  return `${getDatabasePrefix()}_${name}`;
}

export function getPlaceBidFunction() {
  return `${getDatabasePrefix()}_place_bid`;
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

export function getCreateAuctionFunction() {
  return `${getDatabasePrefix()}_create_auction`;
}

export function getConfigureAuctionSpotsFunction() {
  return `${getDatabasePrefix()}_configure_auction_spots`;
}

export function getPlaceAuctionBidFunction() {
  return `${getDatabasePrefix()}_place_auction_bid`;
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
