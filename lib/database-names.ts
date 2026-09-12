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

// The physical Supabase schema still uses the historical laptop table names.
// This alias keeps ownership creation on the auction API without duplicating
// the environment-specific database functions.
export function getCreateOwnedAuctionFunction() {
  return `${getDatabasePrefix()}_create_owned_laptop`;
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
