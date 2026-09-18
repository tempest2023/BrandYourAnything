type Environment = Record<string, string | undefined>;

export type DeploymentKind = "local" | "preview" | "production";
export type StripeMode = "live" | "test";

function localNamespaceTest(env: Environment) {
  if (env.ALLOW_LOCAL_PRODUCTION_NAMESPACE !== "1" || env.VERCEL) return false;
  try { return ["localhost", "127.0.0.1", "[::1]"].includes(new URL(env.SUPABASE_URL || "").hostname); }
  catch { return false; }
}

// Vercel sets VERCEL_ENV for every deployment: production for the production
// domain, preview for branch/PR URLs, development for `vercel dev`. Outside
// Vercel, APP_ENV plays the same role.
export function resolveDeployment(env: Environment): DeploymentKind {
  const value = (env.VERCEL_ENV || env.APP_ENV || "development").trim().toLowerCase();
  if (value === "production") return "production";
  if (value === "preview") return "preview";
  if (value === "development" || value === "local") return "local";
  throw new Error("Unknown deployment environment.");
}

export function resolveDatabasePrefix(env: Environment): "ba_dev" | "ba_prod" {
  const expected = resolveDeployment(env) === "production" ? "ba_prod" : "ba_dev";
  const prefix = env.SUPABASE_DATABASE_PREFIX || expected;
  if (prefix !== "ba_dev" && prefix !== "ba_prod") throw new Error("Invalid database namespace.");
  if (prefix !== expected && !(prefix === "ba_prod" && localNamespaceTest(env))) {
    throw new Error("Database namespace does not match the deployment environment.");
  }
  return prefix;
}

// The Stripe mode is a property of the deployment, not of the key string: the
// production domain talks to live Stripe, while local and preview deployments
// talk to sandbox Stripe whatever key is configured. The configured key is used
// as-is — if it does not belong to the deployment's Stripe mode, Stripe rejects
// the call instead of this module refusing to start.
export function resolveStripeMode(env: Environment): StripeMode {
  return resolveDeployment(env) === "production" ? "live" : "test";
}
