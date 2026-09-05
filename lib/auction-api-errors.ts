export const AUCTION_PUBLISH_ERROR_CODES = [
  "publish_unavailable",
  "slug_taken",
  "rate_limited",
  "request_conflict",
  "authentication_required",
  "authentication_forbidden",
  "invalid_request",
  "publish_failed",
] as const;

export type AuctionPublishErrorCode = (typeof AUCTION_PUBLISH_ERROR_CODES)[number];

export function isAuctionPublishErrorCode(value: unknown): value is AuctionPublishErrorCode {
  return typeof value === "string"
    && (AUCTION_PUBLISH_ERROR_CODES as readonly string[]).includes(value);
}
