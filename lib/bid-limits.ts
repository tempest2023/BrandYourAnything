// Stripe accepts at most eight digits in the smallest currency unit for USD.
export const MAX_BID_AMOUNT_CENTS = 99_999_999;
export const MAX_BID_AMOUNT_USD = MAX_BID_AMOUNT_CENTS / 100;

export function canPlaceBid(spot: { minBid: number }) {
  return Number.isFinite(spot.minBid) && spot.minBid > 0
    && Math.round(spot.minBid * 100) <= MAX_BID_AMOUNT_CENTS;
}
