import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.SUPABASE_ANON_KEY;
const databasePrefix = process.env.SUPABASE_DATABASE_PREFIX || "ba_dev";

if (!url || !serviceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url) && process.env.ALLOW_REMOTE_OWNERSHIP_TEST !== "1") {
  throw new Error("Ownership tests only run locally unless ALLOW_REMOTE_OWNERSHIP_TEST=1.");
}
if (!["ba_dev", "ba_prod"].includes(databasePrefix)) {
  throw new Error("SUPABASE_DATABASE_PREFIX must be ba_dev or ba_prod.");
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const laptopsTable = `${databasePrefix}_laptops`;
const createFunction = `${databasePrefix}_create_owned_laptop`;
const claimFunction = `${databasePrefix}_claim_auction`;
const legacyCreateFunction = `${databasePrefix}_create_laptop`;
const createdLaptopIds = [];
const createdUserIds = [];

function makeRecoveryCode() {
  return `ba_mgr_${randomBytes(32).toString("base64url")}`;
}

function hashRecoveryCode(code) {
  return createHash("sha256").update(code).digest("hex");
}

function createLaptop({ slug, managerKeyHash = null, ownerUserId = null, idempotencyKey = randomUUID() }) {
  return service.rpc(createFunction, {
    p_slug: slug,
    p_owner_user_id: ownerUserId,
    p_manager_key_hash: managerKeyHash,
    p_owner_name: ownerUserId ? "X Test Owner" : "Browser Test Owner",
    p_owner_email: ownerUserId ? `x-${ownerUserId}@auth.brand-anything.vercel.app` : `browser-${slug}@example.com`,
    p_title: `Ownership test ${slug}`,
    p_tagline: "Ownership is verified server-side.",
    p_story: "Temporary local test data.",
    p_laptop_model: "MacBook Pro 14-inch",
    p_goal_cents: 320000,
    p_auction_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_photo_storage_path: null,
    p_small_opening_bid_cents: 12500,
    p_medium_opening_bid_cents: 20000,
    p_large_opening_bid_cents: 40000,
    p_min_increment_cents: 1000,
    p_idempotency_key: idempotencyKey,
  });
}

async function createXTestUser(label) {
  const email = `ownership-${label}-${randomUUID()}@example.com`;
  const { data, error } = await service.auth.admin.createUser({
    email,
    email_confirm: true,
    app_metadata: { provider: "x", providers: ["x"] },
    user_metadata: { user_name: label, name: `X ${label}` },
  });
  if (error) throw error;
  createdUserIds.push(data.user.id);
  return data.user;
}

try {
  const unique = randomUUID().slice(0, 8);
  const recoveryCode = makeRecoveryCode();
  const managerKeyHash = hashRecoveryCode(recoveryCode);
  const browserSlug = `owner-browser-${unique}`;
  const browserCreate = await createLaptop({ slug: browserSlug, managerKeyHash });
  if (browserCreate.error) throw browserCreate.error;
  assert.equal(browserCreate.data[0].accepted, true, "a recovery-code owner can create an auction");
  createdLaptopIds.push(browserCreate.data[0].laptop_id);

  const { data: browserRow, error: browserRowError } = await service
    .from(laptopsTable)
    .select("owner_user_id,manager_key_hash")
    .eq("id", browserCreate.data[0].laptop_id)
    .single();
  if (browserRowError) throw browserRowError;
  assert.equal(browserRow.owner_user_id, null, "accountless creation does not invent an auth user");
  assert.equal(browserRow.manager_key_hash, managerKeyHash, "only the recovery-code hash is stored");
  assert.equal(browserRow.manager_key_hash.includes(recoveryCode), false, "the raw recovery code is not stored");

  const [firstUser, secondUser] = await Promise.all([
    createXTestUser("claim-one"),
    createXTestUser("claim-two"),
  ]);

  const wrongClaim = await service.rpc(claimFunction, {
    p_slug: browserSlug,
    p_manager_key_hashes: [hashRecoveryCode(makeRecoveryCode())],
    p_owner_user_id: firstUser.id,
    p_owner_name: "Wrong claimant",
    p_owner_email: firstUser.email,
  });
  if (wrongClaim.error) throw wrongClaim.error;
  assert.equal(wrongClaim.data[0].reason, "not_found", "a wrong recovery code cannot claim an auction");

  const claimInput = (user) => service.rpc(claimFunction, {
    p_slug: browserSlug,
    p_manager_key_hashes: [managerKeyHash, managerKeyHash.slice(0, 32)],
    p_owner_user_id: user.id,
    p_owner_name: user.user_metadata.name,
    p_owner_email: user.email,
  });
  const competingClaims = await Promise.all([claimInput(firstUser), claimInput(secondUser)]);
  for (const response of competingClaims) if (response.error) throw response.error;
  assert.equal(competingClaims.filter((response) => response.data[0].accepted).length, 1, "only one X identity wins a concurrent claim");
  assert.equal(competingClaims.filter((response) => response.data[0].reason === "claimed_by_another_user").length, 1, "the losing X identity cannot take over");

  const winningIndex = competingClaims.findIndex((response) => response.data[0].accepted);
  const winningUser = winningIndex === 0 ? firstUser : secondUser;
  const retryClaim = await claimInput(winningUser);
  if (retryClaim.error) throw retryClaim.error;
  assert.equal(retryClaim.data[0].reason, "already_claimed", "claim retries are idempotent");

  const { data: claimedRow, error: claimedRowError } = await service
    .from(laptopsTable)
    .select("owner_user_id,manager_key_hash")
    .eq("id", browserCreate.data[0].laptop_id)
    .single();
  if (claimedRowError) throw claimedRowError;
  assert.equal(claimedRow.owner_user_id, winningUser.id, "the auction is bound to the winning auth user id");
  assert.equal(claimedRow.manager_key_hash, managerKeyHash, "claiming keeps recovery access as a backup");

  const xSlug = `owner-x-${unique}`;
  const xCreate = await createLaptop({ slug: xSlug, ownerUserId: winningUser.id });
  if (xCreate.error) throw xCreate.error;
  assert.equal(xCreate.data[0].accepted, true, "an X auth user can create an account-bound auction");
  createdLaptopIds.push(xCreate.data[0].laptop_id);

  const secondXSlug = `${xSlug}-two`;
  const secondXCreate = await createLaptop({ slug: secondXSlug, ownerUserId: winningUser.id });
  if (secondXCreate.error) throw secondXCreate.error;
  assert.equal(secondXCreate.data[0].accepted, true, "the same X auth user can publish multiple auctions at distinct addresses");
  createdLaptopIds.push(secondXCreate.data[0].laptop_id);

  const duplicateAddress = await createLaptop({ slug: secondXSlug, ownerUserId: winningUser.id });
  if (duplicateAddress.error) throw duplicateAddress.error;
  assert.equal(duplicateAddress.data[0].accepted, false, "a public address identifies only one auction");
  assert.equal(duplicateAddress.data[0].reason, "slug_taken", "a duplicate address is rejected independently of its owner");

  const invalidCreate = await createLaptop({
    slug: `owner-invalid-${unique}`,
    ownerUserId: winningUser.id,
    managerKeyHash: hashRecoveryCode(makeRecoveryCode()),
  });
  assert.ok(invalidCreate.error, "creation rejects ambiguous dual credentials");

  const legacyCreate = await service.rpc(legacyCreateFunction, {
    p_slug: `owner-legacy-${unique}`,
    p_owner_name: "Unbound owner",
    p_owner_email: `legacy-${unique}@example.com`,
    p_title: "Legacy unbound auction",
    p_tagline: "This call must be disabled.",
    p_story: "Ownership tests reject this path.",
    p_laptop_model: "MacBook Pro 14-inch",
    p_goal_cents: 320000,
    p_auction_closes_at: new Date(Date.now() + 86_400_000).toISOString(),
    p_photo_storage_path: null,
    p_small_opening_bid_cents: 12500,
    p_medium_opening_bid_cents: 20000,
    p_large_opening_bid_cents: 40000,
    p_min_increment_cents: 1000,
    p_idempotency_key: randomUUID(),
  });
  assert.ok(legacyCreate.error, "the privileged legacy wrapper cannot create an ownerless auction");

  if (anonKey) {
    const anon = createClient(url, anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const anonymousClaim = await anon.rpc(claimFunction, {
      p_slug: browserSlug,
      p_manager_key_hashes: [managerKeyHash],
      p_owner_user_id: secondUser.id,
      p_owner_name: "Anonymous",
      p_owner_email: secondUser.email,
    });
    assert.ok(anonymousClaim.error, "browser clients cannot call the privileged claim function directly");
  }

  console.log(`Auction ownership checks passed for ${databasePrefix}: recovery hashes, X user ids, atomic claims, retries, and grants work.`);
} finally {
  if (createdLaptopIds.length) {
    const { error } = await service.from(laptopsTable).delete().in("id", createdLaptopIds);
    if (error) console.error("Could not remove ownership-test auctions", error.message);
  }
  for (const userId of createdUserIds) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) console.error("Could not remove ownership-test auth user", error.message);
  }
}
