import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const browserKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
  || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  || process.env.SUPABASE_ANON_KEY;
const databasePrefix = process.env.SUPABASE_DATABASE_PREFIX || "ba_dev";
const appUrl = (process.env.OWNERSHIP_API_URL || "http://127.0.0.1:3000").replace(/\/$/, "");

if (!url || !serviceKey || !browserKey) {
  throw new Error("Supabase server and browser credentials are required.");
}
if (databasePrefix !== "ba_dev") {
  throw new Error("The ownership API test expects the local Next.js server to use ba_dev.");
}
if (!/^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(appUrl)) {
  throw new Error("Ownership API tests only target a local Next.js server.");
}

const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const authClient = createClient(url, browserKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const laptopsTable = `${databasePrefix}_laptops`;
const createFunction = `${databasePrefix}_create_owned_laptop`;
let laptopId = null;
let userId = null;

async function payload(response) {
  const body = await response.json();
  if (!response.ok) throw new Error(`${response.status}: ${body.error || JSON.stringify(body)}`);
  return body;
}

try {
  const unique = randomUUID().slice(0, 8);
  const email = `ownership-api-${unique}@example.com`;
  const password = `Test-${randomBytes(24).toString("base64url")}`;
  const { data: userData, error: userError } = await service.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    app_metadata: { provider: "x", providers: ["x"] },
    user_metadata: { user_name: `owner_${unique}`, name: "Ownership API Test" },
  });
  if (userError) throw userError;
  userId = userData.user.id;

  const { data: sessionData, error: sessionError } = await authClient.auth.signInWithPassword({ email, password });
  if (sessionError || !sessionData.session) throw sessionError || new Error("The local test user did not receive a session.");
  const token = sessionData.session.access_token;

  const recoveryCode = `ba_mgr_${randomBytes(32).toString("base64url")}`;
  const managerKeyHash = createHash("sha256").update(recoveryCode).digest("hex");
  const slug = `owner-api-${unique}`;
  const { data: creation, error: createError } = await service.rpc(createFunction, {
    p_slug: slug,
    p_owner_user_id: null,
    p_manager_key_hash: managerKeyHash,
    p_owner_name: "Browser API Test",
    p_owner_email: `browser-${unique}@example.com`,
    p_title: `Ownership API ${unique}`,
    p_tagline: "Temporary local API test.",
    p_story: "This auction is removed after the test.",
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
  if (createError) throw createError;
  laptopId = creation[0].laptop_id;

  const manageUrl = `${appUrl}/api/laptops/${slug}/manage`;
  const anonymousResponse = await fetch(manageUrl);
  assert.equal(anonymousResponse.status, 401, "management rejects missing credentials");

  const browserOwned = await payload(await fetch(manageUrl, {
    headers: { "X-Lid-Manager-Key": recoveryCode },
  }));
  assert.equal(browserOwned.auction.claimedByX, false, "the recovery-owned auction starts accountless");

  const claimed = await payload(await fetch(manageUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "X-Lid-Manager-Key": recoveryCode,
    },
  }));
  assert.equal(claimed.auction.claimedByX, true, "the authenticated X identity claims the auction");

  const mine = await payload(await fetch(`${appUrl}/api/laptops/mine`, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.ok(mine.auctions.some((auction) => auction.slug === slug), "the claimed auction appears in the X account list");

  const xOwned = await payload(await fetch(manageUrl, {
    headers: { Authorization: `Bearer ${token}` },
  }));
  assert.equal(xOwned.auction.slug, slug, "the X credential manages its claimed auction");

  const recoveryStillWorks = await payload(await fetch(manageUrl, {
    headers: { "X-Lid-Manager-Key": recoveryCode },
  }));
  assert.equal(recoveryStillWorks.auction.browserRecoveryEnabled, true, "the recovery credential remains a backup after claiming");
  const managerCannotRevokeItself = await fetch(manageUrl, {
    method: "PATCH",
    headers: { "X-Lid-Manager-Key": recoveryCode, "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryAction: "disable" }),
  });
  assert.equal(managerCannotRevokeItself.status, 401, "only the X owner can rotate or disable recovery access");

  const rotatedRecoveryCode = `ba_mgr_${randomBytes(32).toString("base64url")}`;
  const rotated = await payload(await fetch(manageUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryAction: "rotate", recoveryCode: rotatedRecoveryCode }),
  }));
  assert.equal(rotated.auction.browserRecoveryEnabled, true, "the X owner can rotate recovery access");
  const expiredRecovery = await fetch(manageUrl, {
    headers: { "X-Lid-Manager-Key": recoveryCode },
  });
  assert.equal(expiredRecovery.status, 404, "the previous recovery code stops working immediately");
  const rotatedRecovery = await payload(await fetch(manageUrl, {
    headers: { "X-Lid-Manager-Key": rotatedRecoveryCode },
  }));
  assert.equal(rotatedRecovery.auction.slug, slug, "the rotated recovery code manages the auction");

  const disabled = await payload(await fetch(manageUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryAction: "disable" }),
  }));
  assert.equal(disabled.auction.browserRecoveryEnabled, false, "the X owner can disable recovery access");
  const disabledRecovery = await fetch(manageUrl, {
    headers: { "X-Lid-Manager-Key": rotatedRecoveryCode },
  });
  assert.equal(disabledRecovery.status, 404, "disabled recovery access cannot manage the auction");

  const recreatedRecoveryCode = `ba_mgr_${randomBytes(32).toString("base64url")}`;
  const recreated = await payload(await fetch(manageUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ recoveryAction: "rotate", recoveryCode: recreatedRecoveryCode }),
  }));
  assert.equal(recreated.auction.browserRecoveryEnabled, true, "an X-only auction can create a fresh browser backup");
  const recreatedRecovery = await payload(await fetch(manageUrl, {
    headers: { "X-Lid-Manager-Key": recreatedRecoveryCode },
  }));
  assert.equal(recreatedRecovery.auction.slug, slug, "the fresh browser backup manages the X-owned auction");

  const closed = await payload(await fetch(manageUrl, {
    method: "PATCH",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ status: "closed" }),
  }));
  assert.equal(closed.auction.status, "closed", "the X owner can close its auction");

  console.log("Ownership API checks passed: recovery management, X claim/list/manage, backup rotation/revocation, and close work end to end.");
} finally {
  if (laptopId) {
    const { error } = await service.from(laptopsTable).delete().eq("id", laptopId);
    if (error) console.error("Could not remove the ownership API test auction", error.message);
  }
  if (userId) {
    const { error } = await service.auth.admin.deleteUser(userId);
    if (error) console.error("Could not remove the ownership API test user", error.message);
  }
}
