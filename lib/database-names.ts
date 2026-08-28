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
