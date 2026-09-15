import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { paymentWorkFetch, paymentWorkRemaining } from "@/lib/payment-work-budget";

let adminClient: SupabaseClient | undefined;
let recoveryAdminClient: SupabaseClient | undefined;

export function isSupabaseConfigured() {
  return Boolean(
    process.env.SUPABASE_URL &&
    (process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY),
  );
}

export function getSupabaseAdmin() {
  const bounded = Number.isFinite(paymentWorkRemaining());
  const cached = bounded ? recoveryAdminClient : adminClient;
  if (cached) return cached;

  const url = process.env.SUPABASE_URL;
  const secretKey = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !secretKey) {
    throw new Error("Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY.");
  }

  const client = createClient(url, secretKey, {
    // A Retry-After response can make the SDK sleep beyond the worker deadline.
    // Durable recovery owns its retries; ordinary requests retain SDK defaults.
    db: { retry: !bounded },
    global: { fetch: paymentWorkFetch },
    auth: {
      autoRefreshToken: false,
      detectSessionInUrl: false,
      persistSession: false,
    },
  });

  if (bounded) recoveryAdminClient = client;
  else adminClient = client;
  return client;
}
