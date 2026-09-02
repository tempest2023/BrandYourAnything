import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const databasePrefix = process.env.SUPABASE_DATABASE_PREFIX || "ba_dev";

if (!url || !serviceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) && process.env.ALLOW_REMOTE_CONCURRENCY_TEST !== "1") {
  throw new Error("Laptop platform tests only run locally unless ALLOW_REMOTE_CONCURRENCY_TEST=1.");
}
if (!["ba_dev", "ba_prod"].includes(databasePrefix)) {
  throw new Error("SUPABASE_DATABASE_PREFIX must be ba_dev or ba_prod.");
}

const laptopsTable = `${databasePrefix}_laptops`;
const spotsTable = `${databasePrefix}_laptop_spots`;
const bidsTable = `${databasePrefix}_laptop_bids`;
const createFunction = `${databasePrefix}_create_owned_laptop`;
const bidFunction = `${databasePrefix}_place_laptop_bid`;
const service = createClient(url, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } });

const { data: defaultCampaigns, error: defaultCampaignError } = await service
  .from(laptopsTable)
  .select("id,slug")
  .eq("is_default", true);
if (defaultCampaignError) throw defaultCampaignError;
assert.equal(defaultCampaigns.length, 1, "the environment has exactly one homepage auction");
assert.equal(defaultCampaigns[0].slug, "brand-my-mac", "the homepage points to the seeded Mac auction");

const { count: defaultSpotCount, error: defaultSpotCountError } = await service
  .from(spotsTable)
  .select("id", { count: "exact", head: true })
  .eq("laptop_id", defaultCampaigns[0].id);
if (defaultSpotCountError) throw defaultSpotCountError;
assert.equal(defaultSpotCount, 10, "the homepage auction has all ten bid positions");

function createLaptop(args) {
  return service.rpc(createFunction, {
    p_slug: args.slug,
    p_owner_user_id: args.ownerUserId ?? null,
    p_manager_key_hash: args.managerKeyHash ?? null,
    p_owner_name: args.ownerName,
    p_owner_email: args.ownerEmail,
    p_title: args.title,
    p_tagline: args.tagline,
    p_story: args.story,
    p_laptop_model: args.laptopModel,
    p_goal_cents: args.goalCents,
    p_auction_closes_at: args.auctionClosesAt,
    p_photo_storage_path: null,
    p_small_opening_bid_cents: args.smallOpeningBidCents,
    p_medium_opening_bid_cents: args.mediumOpeningBidCents,
    p_large_opening_bid_cents: args.largeOpeningBidCents,
    p_min_increment_cents: args.minIncrementCents,
    p_idempotency_key: args.idempotencyKey,
  });
}

function placeBid(args) {
  return service.rpc(bidFunction, {
    p_laptop_slug: args.slug,
    p_spot_position: args.position,
    p_amount_cents: args.amountCents,
    p_bidder_name: args.name,
    p_bidder_email: args.email,
    p_website: null,
    p_x_handle: null,
    p_logo_storage_path: null,
    p_idempotency_key: args.idempotencyKey,
  });
}

const unique = randomUUID().slice(0, 8);
const managerKeyHash = createHash("sha256").update(`test-manager-${randomUUID()}`).digest("hex");
const closesAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString();
const base = {
  slug: `platform-${databasePrefix.replace("_", "-")}-${unique}`,
  ownerName: "Platform Owner",
  ownerEmail: `owner-${unique}@example.com`,
  ownerUserId: null,
  managerKeyHash,
  title: "Concurrency Laptop",
  tagline: "A real multi-tenant laptop auction.",
  story: "This campaign exists to prove that creation and bidding are isolated and atomic.",
  laptopModel: "MacBook Pro 14-inch",
  goalCents: 320000,
  auctionClosesAt: closesAt,
  smallOpeningBidCents: 12500,
  mediumOpeningBidCents: 20000,
  largeOpeningBidCents: 40000,
  minIncrementCents: 1000,
  idempotencyKey: randomUUID(),
};

const createResponses = await Promise.all([createLaptop(base), createLaptop(base)]);
for (const response of createResponses) {
  if (response.error) throw response.error;
  assert.equal(response.data[0].accepted, true, "concurrent creation retries both succeed");
}
assert.equal(createResponses.filter((response) => response.data[0].reason === "created").length, 1, "one request creates the laptop");
assert.equal(createResponses.filter((response) => response.data[0].reason === "already_processed").length, 1, "one request is an idempotent retry");

const changedPricingRetry = await createLaptop({
  ...base,
  smallOpeningBidCents: base.smallOpeningBidCents + 100,
});
if (changedPricingRetry.error) throw changedPricingRetry.error;
assert.equal(changedPricingRetry.data[0].accepted, false, "an idempotency retry cannot change pricing");
assert.equal(changedPricingRetry.data[0].reason, "idempotency_conflict", "changed pricing returns an idempotency conflict");

const { data: createdLaptop, error: laptopError } = await service
  .from(laptopsTable)
  .select("id")
  .eq("slug", base.slug)
  .single();
if (laptopError) throw laptopError;

const { count: spotCount, error: spotCountError } = await service
  .from(spotsTable)
  .select("id", { count: "exact", head: true })
  .eq("laptop_id", createdLaptop.id);
if (spotCountError) throw spotCountError;
assert.equal(spotCount, 10, "creation atomically produces ten spots");

const slugCollision = await createLaptop({
  ...base,
  title: "Different Laptop",
  idempotencyKey: randomUUID(),
});
if (slugCollision.error) throw slugCollision.error;
assert.equal(slugCollision.data[0].accepted, false, "a duplicate slug is rejected");
assert.equal(slugCollision.data[0].reason, "slug_taken", "duplicate slug returns a useful reason");

const second = {
  ...base,
  slug: `${base.slug}-two`,
  ownerEmail: `owner-two-${unique}@example.com`,
  managerKeyHash: createHash("sha256").update(`test-manager-${randomUUID()}`).digest("hex"),
  title: "Second Isolated Laptop",
  idempotencyKey: randomUUID(),
};
const secondCreate = await createLaptop(second);
if (secondCreate.error) throw secondCreate.error;
assert.equal(secondCreate.data[0].accepted, true, "a second tenant can create a laptop");

const raceKeys = [randomUUID(), randomUUID()];
const raceResponses = await Promise.all([
  placeBid({ slug: base.slug, position: 1, amountCents: 40000, name: "Race A", email: "race-a@example.com", idempotencyKey: raceKeys[0] }),
  placeBid({ slug: base.slug, position: 1, amountCents: 40000, name: "Race B", email: "race-b@example.com", idempotencyKey: raceKeys[1] }),
]);
for (const response of raceResponses) if (response.error) throw response.error;
assert.equal(raceResponses.filter((response) => response.data[0].accepted).length, 1, "one equal concurrent laptop bid wins");
assert.equal(raceResponses.filter((response) => response.data[0].reason === "bid_too_low").length, 1, "the loser sees the committed price");

const isolatedBid = await placeBid({
  slug: second.slug,
  position: 1,
  amountCents: 40000,
  name: "Second Tenant Bid",
  email: "second-tenant@example.com",
  idempotencyKey: randomUUID(),
});
if (isolatedBid.error) throw isolatedBid.error;
assert.equal(isolatedBid.data[0].accepted, true, "the same spot number on another laptop is isolated");

const crossLaptopKey = randomUUID();
const crossLaptopResponses = await Promise.all([
  placeBid({ slug: base.slug, position: 2, amountCents: 40000, name: "Cross Laptop", email: "cross@example.com", idempotencyKey: crossLaptopKey }),
  placeBid({ slug: second.slug, position: 2, amountCents: 40000, name: "Cross Laptop", email: "cross@example.com", idempotencyKey: crossLaptopKey }),
]);
for (const response of crossLaptopResponses) if (response.error) throw response.error;
assert.equal(crossLaptopResponses.filter((response) => response.data[0].accepted).length, 1, "an idempotency key is accepted once across tenants");
assert.equal(crossLaptopResponses.filter((response) => response.data[0].reason === "idempotency_conflict").length, 1, "cross-tenant key reuse is rejected");

const { count: crossLaptopBidCount, error: crossLaptopCountError } = await service
  .from(bidsTable)
  .select("id", { count: "exact", head: true })
  .eq("idempotency_key", crossLaptopKey);
if (crossLaptopCountError) throw crossLaptopCountError;
assert.equal(crossLaptopBidCount, 1, "cross-tenant idempotency produces one ledger row");

if (anonKey) {
  const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const anonRead = await anon.from(laptopsTable).select("owner_email").limit(1);
  assert.ok(anonRead.error, "anonymous clients cannot read owner emails or tables directly");
}

const { error: cleanupError } = await service
  .from(laptopsTable)
  .delete()
  .in("slug", [base.slug, second.slug]);
if (cleanupError) throw cleanupError;

console.log(`Laptop platform checks passed for ${databasePrefix}: default homepage data, creation, tenancy, RLS, row locking, and idempotency work.`);
