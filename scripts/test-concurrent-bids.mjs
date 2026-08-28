import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const key = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!url || !key) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) && process.env.ALLOW_REMOTE_CONCURRENCY_TEST !== "1") {
  throw new Error("Concurrency tests only run against local Supabase unless ALLOW_REMOTE_CONCURRENCY_TEST=1.");
}

const supabase = createClient(url, key, {
  auth: { autoRefreshToken: false, persistSession: false },
});

async function spot(id) {
  const { data, error } = await supabase
    .from("spots")
    .select("current_bid_cents,min_increment_cents,bid_count")
    .eq("id", id)
    .single();
  if (error) throw error;
  return data;
}

function bid(args) {
  return supabase.rpc("place_bid", {
    p_spot_id: args.spotId,
    p_amount_cents: args.amountCents,
    p_bidder_name: args.name,
    p_bidder_email: args.email,
    p_website: null,
    p_x_handle: null,
    p_logo_storage_path: null,
    p_idempotency_key: args.key,
  });
}

const beforeRace = await spot(2);
const raceAmount = beforeRace.current_bid_cents + beforeRace.min_increment_cents;
const raceKeys = [randomUUID(), randomUUID()];
const raceResponses = await Promise.all([
  bid({ spotId: 2, amountCents: raceAmount, name: "Race A", email: "race-a@example.com", key: raceKeys[0] }),
  bid({ spotId: 2, amountCents: raceAmount, name: "Race B", email: "race-b@example.com", key: raceKeys[1] }),
]);

for (const response of raceResponses) {
  if (response.error) throw response.error;
}
const raceResults = raceResponses.map((response) => response.data[0]);
assert.equal(raceResults.filter((result) => result.accepted).length, 1, "exactly one equal concurrent bid is accepted");
assert.equal(raceResults.filter((result) => result.reason === "bid_too_low").length, 1, "the loser sees the updated minimum");

const afterRace = await spot(2);
assert.equal(afterRace.current_bid_cents, raceAmount, "the winning price is stored once");
assert.equal(afterRace.bid_count, beforeRace.bid_count + 1, "the bid count increments once");

const beforeRetry = await spot(1);
const retryAmount = beforeRetry.current_bid_cents + beforeRetry.min_increment_cents;
const retryKey = randomUUID();
const retryResponses = await Promise.all([
  bid({ spotId: 1, amountCents: retryAmount, name: "Retry Brand", email: "retry@example.com", key: retryKey }),
  bid({ spotId: 1, amountCents: retryAmount, name: "Retry Brand", email: "retry@example.com", key: retryKey }),
]);

for (const response of retryResponses) {
  if (response.error) throw response.error;
  assert.equal(response.data[0].accepted, true, "idempotent retries both receive success");
}

const { count, error: countError } = await supabase
  .from("bids")
  .select("id", { count: "exact", head: true })
  .eq("idempotency_key", retryKey);
if (countError) throw countError;
assert.equal(count, 1, "idempotent retries create one bid row");

const afterRetry = await spot(1);
assert.equal(afterRetry.current_bid_cents, retryAmount, "an idempotent retry changes the price once");
assert.equal(afterRetry.bid_count, beforeRetry.bid_count + 1, "an idempotent retry increments once");

const crossSpotKey = randomUUID();
const spotThree = await spot(3);
const spotFour = await spot(4);
const crossSpotResponses = await Promise.all([
  bid({ spotId: 3, amountCents: spotThree.current_bid_cents + spotThree.min_increment_cents, name: "Cross Spot", email: "cross-spot@example.com", key: crossSpotKey }),
  bid({ spotId: 4, amountCents: spotFour.current_bid_cents + spotFour.min_increment_cents, name: "Cross Spot", email: "cross-spot@example.com", key: crossSpotKey }),
]);

for (const response of crossSpotResponses) {
  if (response.error) throw response.error;
}
const crossSpotResults = crossSpotResponses.map((response) => response.data[0]);
assert.equal(crossSpotResults.filter((result) => result.accepted).length, 1, "a key reused across spots is accepted once");
assert.equal(crossSpotResults.filter((result) => result.reason === "idempotency_conflict").length, 1, "cross-spot key reuse returns a conflict");

const { count: crossSpotCount, error: crossSpotCountError } = await supabase
  .from("bids")
  .select("id", { count: "exact", head: true })
  .eq("idempotency_key", crossSpotKey);
if (crossSpotCountError) throw crossSpotCountError;
assert.equal(crossSpotCount, 1, "cross-spot key reuse creates one bid row");

console.log("Concurrency checks passed: row locking and idempotency are working.");
