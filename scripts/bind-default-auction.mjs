import { createHash, randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

const url = process.env.SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;
const requestedEnvironment = process.argv.find((argument) => argument.startsWith("--environment="))?.split("=", 2)[1]
  || process.env.SUPABASE_DATABASE_PREFIX?.replace(/^ba_/, "")
  || "dev";
const replaceExisting = process.argv.includes("--replace");
const suppliedCode = process.env.DEFAULT_AUCTION_MANAGER_RECOVERY_CODE?.trim();
const isLocal = Boolean(url && /^https?:\/\/(127\.0\.0\.1|localhost)(:|\/)/.test(url));

if (!url || !serviceKey) {
  throw new Error("Set SUPABASE_URL and SUPABASE_SECRET_KEY (or SUPABASE_SERVICE_ROLE_KEY).");
}
if (!["dev", "prod"].includes(requestedEnvironment)) {
  throw new Error("Use --environment=dev or --environment=prod.");
}
if (!isLocal && process.env.ALLOW_REMOTE_DEFAULT_BIND !== "1") {
  throw new Error("Remote binding is disabled. Review the target, then set ALLOW_REMOTE_DEFAULT_BIND=1.");
}

const recoveryCode = suppliedCode || `ba_mgr_${randomBytes(32).toString("base64url")}`;
if (!/^ba_mgr_[A-Za-z0-9_-]{43}$/.test(recoveryCode)) {
  throw new Error("DEFAULT_AUCTION_MANAGER_RECOVERY_CODE must be a complete ba_mgr_ recovery code.");
}

const prefix = `ba_${requestedEnvironment}`;
const table = `${prefix}_laptops`;
const hash = createHash("sha256").update(recoveryCode).digest("hex");
const service = createClient(url, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: current, error: readError } = await service
  .from(table)
  .select("id,slug,title,manager_key_hash,owner_user_id")
  .eq("is_default", true)
  .single();
if (readError) throw readError;
if (current.manager_key_hash && current.manager_key_hash !== hash && !replaceExisting) {
  throw new Error("The default auction already has a different recovery owner. Use its existing code, or pass --replace deliberately.");
}

const { error: updateError } = await service
  .from(table)
  .update({ manager_key_hash: hash, updated_at: new Date().toISOString() })
  .eq("id", current.id);
if (updateError) throw updateError;

console.log(`Default ${requestedEnvironment} auction bound: /${current.slug}`);
console.log("Save this recovery code now; only its hash was stored in Supabase:");
console.log(recoveryCode);
console.log("Open /manage to verify and save it in your browser, then attach it to X whenever X sign-in is available.");
