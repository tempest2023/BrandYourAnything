import assert from "node:assert/strict";
import test from "node:test";
import { loadTypeScript } from "./lib/load-typescript.mjs";

const { appendLogoCoverSpot, laptopBaseSpotCount, laptopSpotNameKey } = loadTypeScript("lib/laptop-layout.ts");
const { parseAuctionForm } = loadTypeScript("lib/auction-validation.ts");
const { canPlaceBid, MAX_BID_AMOUNT_USD } = loadTypeScript("lib/bid-limits.ts");
const { minimumDisplayAmount, maximumDisplayAmount, amountToUsdCents } = loadTypeScript("lib/money.ts");

test("all six/ten layouts persist the optional central logo spot, without renumbering", () => {
  for (const count of [6, 10]) {
    const base = Array.from({ length: count }, (_, i) => ({ id: i + 1, name: `Spot ${i + 1}`, size: "L", dimensions: "9.5 × 5.5 cm", openingBidCents: 40013 }));
    const layout = appendLogoCoverSpot(base, 1500.27);
    assert.deepEqual(layout.slice(0, count), base);
    assert.equal(layout.at(-1).openingBidCents, 150027);
    assert.equal(layout.at(-1).dimensions, "6 × 6 cm");
    assert.equal(laptopBaseSpotCount(layout), count);
    assert.equal(laptopSpotNameKey(layout.at(-1), layout), "common.logoCover");
    const form = new FormData();
    for (const [key, value] of Object.entries({ slug: "layout-test", ownerName: "Layout test", ownerEmail: "layout@example.test",
      title: "Layout regression", tagline: "Testing logo persistence", story: "A fixture for six and ten spot layout validation.",
      objectName: "Mac · 14″", assetType: "laptop", assetName: "Mac · 14″", goalCents: 320000,
      smallOpeningBidCents: 12500, mediumOpeningBidCents: 20000, largeOpeningBidCents: 40000, minIncrementCents: 1000,
      idempotencyKey: crypto.randomUUID(), auctionClosesAt: new Date(Date.now() + 7 * 86_400_000).toISOString(),
    })) form.set(key, String(value));
    for (const spots of [base, layout]) {
      form.set("layoutCount", String(spots.length)); form.set("spotLayout", JSON.stringify(spots));
      assert.deepEqual(parseAuctionForm(form).spotLayout, spots);
    }
    form.set("spotLayout", JSON.stringify(layout.map(({ logoCover, ...rest }) => { void logoCover; return rest; })));
    assert.throws(() => parseAuctionForm(form), /logo-cover/);
    form.set("spotLayout", JSON.stringify(layout)); form.set("objectName", "PC · 14″");
    assert.throws(() => parseAuctionForm(form), /logo-cover/);
  }
});

test("maximum bid disables only exhausted positions; cent-level floors remain payable", () => {
  assert.equal(canPlaceBid({ minBid: MAX_BID_AMOUNT_USD }), true);
  assert.equal(canPlaceBid({ minBid: MAX_BID_AMOUNT_USD + 0.01 }), false);
  for (const invalid of [NaN, Infinity, -1, 0]) assert.equal(canPlaceBid({ minBid: invalid }), false);
  assert.equal(minimumDisplayAmount(MAX_BID_AMOUNT_USD, "USD"), MAX_BID_AMOUNT_USD);
  assert.equal(minimumDisplayAmount(400.13, "USD"), 400.13);
});

test("display-currency bounds are cent-exact and round back inside USD limits", () => {
  for (const currency of ["USD", "EUR", "CNY"]) {
    for (const cents of [100, 101, 1000, 40013, 99999997, 99999998, 99999999]) {
      const minimum = minimumDisplayAmount(cents / 100, currency);
      const maximum = maximumDisplayAmount(cents / 100, currency);
      assert.ok(amountToUsdCents(minimum, currency) >= cents);
      assert.ok(amountToUsdCents(minimum - 0.01, currency) < cents);
      assert.ok(amountToUsdCents(maximum, currency) <= cents);
      assert.ok(amountToUsdCents(maximum + 0.01, currency) > cents);
    }
  }
  assert.ok(Number.isNaN(minimumDisplayAmount(Infinity, "USD")));
  assert.ok(Number.isNaN(maximumDisplayAmount(1e25, "USD")));
});
