import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./lib/load-typescript.mjs";

const {
  MAX_BID_AMOUNT_CENTS,
  MAX_BID_AMOUNT_USD,
  MIN_BID_AMOUNT_CENTS,
  MIN_BID_AMOUNT_USD,
  canPlaceBid,
} = loadTypeScript("lib/bid-limits.ts");
const { parseBidForm } = loadTypeScript("lib/bid-validation.ts");
const { parseAuctionForm } = loadTypeScript("lib/auction-validation.ts");
const { amountToUsdCents, minimumDisplayAmount } = loadTypeScript("lib/money.ts");

function bidForm(amountCents) {
  const form = new FormData();
  for (const [key, value] of Object.entries({
    spotId: "1",
    amountCents: String(amountCents),
    brandName: "Boundary brand",
    email: "bidder@example.test",
    idempotencyKey: crypto.randomUUID(),
  })) form.set(key, value);
  return form;
}

function auctionForm({ spot = {}, ...overrides } = {}) {
  const form = new FormData();
  const values = {
    slug: `boundary-auction-${crypto.randomUUID().slice(0, 8)}`,
    ownerName: "Boundary owner",
    ownerEmail: "owner@example.test",
    title: "Boundary auction",
    tagline: "Checking the payable opening price",
    story: "A fixture that checks the payable opening bid floor end to end.",
    objectName: "Mac · 14″",
    assetType: "laptop",
    assetName: "Mac · 14″",
    goalCents: 320000,
    smallOpeningBidCents: 12500,
    mediumOpeningBidCents: 20000,
    largeOpeningBidCents: 40000,
    minIncrementCents: 1000,
    layoutCount: 6,
    idempotencyKey: crypto.randomUUID(),
    auctionClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    ...overrides,
  };
  for (const [key, value] of Object.entries(values)) form.set(key, String(value));
  form.set("spotLayout", JSON.stringify(Array.from({ length: 6 }, (_, index) => ({
    id: index + 1,
    name: `Spot ${index + 1}`,
    size: "L",
    dimensions: "9.5 × 5.5 cm",
    openingBidCents: 40000,
    ...spot,
  }))));
  return form;
}

test("the payable bid floor is shared, cent-exact and below the Stripe maximum", () => {
  assert.equal(MIN_BID_AMOUNT_CENTS, 1000);
  assert.equal(MIN_BID_AMOUNT_USD, 10);
  assert.equal(MAX_BID_AMOUNT_CENTS, 99_999_999);
  assert.equal(MAX_BID_AMOUNT_USD, 999_999.99);
  assert.ok(MIN_BID_AMOUNT_CENTS < MAX_BID_AMOUNT_CENTS);
});

test("paid bid parsing accepts the exact bounds and rejects everything outside them", () => {
  for (const amount of [1000, 1001, 12_345, MAX_BID_AMOUNT_CENTS]) {
    assert.equal(parseBidForm(bidForm(amount)).amountCents, amount);
  }
  for (const amount of [0, 100, 999, -1000, MAX_BID_AMOUNT_CENTS + 1, 1000.5, Number.NaN]) {
    assert.throws(() => parseBidForm(bidForm(amount)), /between \$10 and \$999,999\.99/, `${amount} must be refused`);
  }
});

test("a spot advertises a bid only when the paid Checkout path can accept one", () => {
  assert.equal(canPlaceBid({ minBid: MIN_BID_AMOUNT_USD }), true);
  assert.equal(canPlaceBid({ minBid: MAX_BID_AMOUNT_USD }), true);
  for (const minBid of [MIN_BID_AMOUNT_USD - 0.01, 1, 0, -5, NaN, Infinity, MAX_BID_AMOUNT_USD + 0.01]) {
    assert.equal(canPlaceBid({ minBid }), false, `${minBid} must not be payable`);
  }
});

test("auction creation refuses opening prices the bid API would always reject", () => {
  for (const field of ["smallOpeningBidCents", "mediumOpeningBidCents", "largeOpeningBidCents"]) {
    assert.throws(() => parseAuctionForm(auctionForm({ [field]: 999 })), /outside the allowed range/);
    assert.equal(parseAuctionForm(auctionForm({ [field]: 1000 }))[field], 1000);
  }
  assert.throws(() => parseAuctionForm(auctionForm({ spot: { openingBidCents: 999 } })), /Spot 1 has invalid placement or pricing details/);
  const accepted = parseAuctionForm(auctionForm({ spot: { openingBidCents: 1000 } }));
  assert.ok(accepted.spotLayout.every((spot) => spot.openingBidCents === 1000));
});

test("the minimum payable bid is representable in every display currency", () => {
  for (const currency of ["USD", "EUR", "CNY"]) {
    const display = minimumDisplayAmount(MIN_BID_AMOUNT_USD, currency);
    assert.ok(Number.isFinite(display) && display > 0);
    assert.ok(amountToUsdCents(display, currency) >= MIN_BID_AMOUNT_CENTS, `${currency} display must clear the payable floor`);
    assert.ok(amountToUsdCents(display - 0.01, currency) < MIN_BID_AMOUNT_CENTS);
  }
});
