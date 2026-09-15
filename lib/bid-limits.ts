// Stripe accepts at most eight digits in the smallest currency unit for USD.
export const MAX_BID_AMOUNT_CENTS = 99_999_999;
export const MAX_BID_AMOUNT_USD = MAX_BID_AMOUNT_CENTS / 100;
