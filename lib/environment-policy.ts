type Environment = Record<string, string | undefined>;

function localNamespaceTest(env: Environment) {
  if (env.ALLOW_LOCAL_PRODUCTION_NAMESPACE !== "1" || env.VERCEL) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.SUPABASE_URL || "").hostname); }
  catch { return false; }
}

export function resolveDatabasePrefix(env: Environment): "ba_dev" | "ba_prod" {
  const deployment = env.VERCEL_ENV || env.APP_ENV || "development";
  if (!["production", "preview", "development"].includes(deployment)) throw new Error("Unknown deployment environment.");
  const expected = deployment === "production" ? "ba_prod" : "ba_dev";
  const prefix = env.SUPABASE_DATABASE_PREFIX || expected;
  if (prefix !== "ba_dev" && prefix !== "ba_prod") throw new Error("Invalid database namespace.");
  if (prefix !== expected && !(prefix === "ba_prod" && localNamespaceTest(env))) {
    throw new Error("Database namespace does not match the deployment environment.");
  }
  return prefix;
}

export function resolveStripeMode(env: Environment): "live" | "test" {
  const mode = env.STRIPE_SECRET_KEY?.trim().match(/^[sr]k_(live|test)_[A-Za-z0-9]+$/)?.[1];
  if (mode !== "live" && mode !== "test") throw new Error("A valid Stripe secret or restricted key is required.");
  const prefix = resolveDatabasePrefix(env);
  if ((prefix === "ba_dev" && mode !== "test") || (prefix === "ba_prod" && mode !== "live" && !localNamespaceTest(env))) {
    throw new Error("Stripe mode does not match the database namespace.");
  }
  return mode;
}
