import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import ts from "typescript";

async function loadPlainModule(path) {
  const source = await readFile(new URL(path, import.meta.url), "utf8");
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } });
  return import(`data:text/javascript;base64,${Buffer.from(outputText).toString("base64")}`);
}

const { createSpotLogoCache, stabilizeSpotLogoUrls, SPOT_LOGO_URL_MAX_AGE_MS } =
  await loadPlainModule("../lib/spot-logo-url.ts");

const LOGO_KEY = "auctions/fixture/2/bid-1-abc123.png";

function spot(logo, logoKey = LOGO_KEY) {
  return { id: 2, name: "Marquee", size: "L", dimensions: "9.5 × 5.5 cm", holder: "Acme", bid: 400, minBid: 420, bids: 1, logo, logoKey };
}

test("a re-signed Storage URL does not change the URL the browser already has", () => {
  const cache = createSpotLogoCache();
  const first = stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=one")], cache, 0);
  const polled = stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=two")], cache, 5_000);
  assert.equal(first[0].logo, "https://db.test/logo.png?token=one");
  assert.equal(polled[0].logo, "https://db.test/logo.png?token=one");
});

test("a replaced logo adopts its freshly signed URL immediately", () => {
  const cache = createSpotLogoCache();
  stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=one")], cache, 0);
  const replaced = stabilizeSpotLogoUrls(
    [spot("https://db.test/newer.png?token=two", "auctions/fixture/2/bid-2-def456.png")],
    cache,
    5_000,
  );
  assert.equal(replaced[0].logo, "https://db.test/newer.png?token=two");
});

test("the held URL is re-signed before the token can expire", () => {
  const cache = createSpotLogoCache();
  stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=one")], cache, 0);
  const held = stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=two")], cache, SPOT_LOGO_URL_MAX_AGE_MS - 1);
  assert.equal(held[0].logo, "https://db.test/logo.png?token=one");
  const refreshed = stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=three")], cache, SPOT_LOGO_URL_MAX_AGE_MS + 1);
  assert.equal(refreshed[0].logo, "https://db.test/logo.png?token=three");
});

test("an outbid spot drops its cached entry and a missing key stays untouched", () => {
  const cache = createSpotLogoCache();
  stabilizeSpotLogoUrls([spot("https://db.test/logo.png?token=one")], cache, 0);
  assert.equal(cache.size, 1);
  const cleared = stabilizeSpotLogoUrls([{ ...spot(undefined), logoKey: undefined }], cache, 5_000);
  assert.equal(cleared[0].logo, undefined);
  assert.equal(cache.size, 0);
  const starter = stabilizeSpotLogoUrls([{ ...spot(undefined), logoKey: undefined }], cache, 5_000);
  assert.equal(starter[0].logoKey, undefined);
});
