// Stripe accepts at most eight digits in the smallest currency unit for USD.
export const MAX_BID_AMOUNT_CENTS = 99_999_999;
export const MAX_BID_AMOUNT_USD = MAX_BID_AMOUNT_CENTS / 100;

// Every payable bid — and therefore every advertised opening price — has to
// clear the smallest deposit the paid Checkout path will charge. Creation, the
// bid API and the database constraint share this floor so a spot can never
// advertise a price that Checkout rejects as too low.
export const MIN_BID_AMOUNT_CENTS = 1_000;
export const MIN_BID_AMOUNT_USD = MIN_BID_AMOUNT_CENTS / 100;

export function canPlaceBid(spot: { minBid: number }) {
  if (!Number.isFinite(spot.minBid)) return false;
  const cents = Math.round(spot.minBid * 100);
  return cents >= MIN_BID_AMOUNT_CENTS && cents <= MAX_BID_AMOUNT_CENTS;
}
