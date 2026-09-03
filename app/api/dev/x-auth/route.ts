import { createClient, type User } from "@supabase/supabase-js";

import { getDatabasePrefix } from "@/lib/database-names";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export const runtime = "nodejs";

const MOCK_EMAIL = "local-x-owner@brand-anything.test";
const MOCK_PASSWORD = "BrandAnything-Local-X-Mock-Only-2026";
const MOCK_METADATA = {
  app_metadata: { provider: "x", providers: ["x"] },
  user_metadata: { user_name: "brand_anything_dev", name: "Brand Anything Dev" },
};

function isLocalSupabase(url: string | undefined) {
  return Boolean(url && /^https?:\/\/(?:127\.0\.0\.1|localhost)(?::|\/)/i.test(url));
}

function isMockEnabled() {
  return process.env.NODE_ENV === "development"
    && process.env.NEXT_PUBLIC_X_AUTH_DEV_MOCK === "1"
    && getDatabasePrefix() === "ba_dev"
    && isLocalSupabase(process.env.SUPABASE_URL);
}

async function findMockUser() {
  const admin = getSupabaseAdmin();
  for (let page = 1; page <= 20; page += 1) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 200 });
    if (error) throw error;
    const user = data.users.find((candidate) => candidate.email === MOCK_EMAIL);
    if (user) return user;
    if (data.users.length < 200) return null;
  }
  throw new Error("The local mock X user could not be located.");
}

async function ensureMockUser(): Promise<User> {
  const admin = getSupabaseAdmin();
  const existing = await findMockUser();
  if (existing) {
    const { data, error } = await admin.auth.admin.updateUserById(existing.id, {
      email: MOCK_EMAIL,
      password: MOCK_PASSWORD,
      email_confirm: true,
      ...MOCK_METADATA,
    });
    if (error) throw error;
    return data.user;
  }

  const { data, error } = await admin.auth.admin.createUser({
    email: MOCK_EMAIL,
    password: MOCK_PASSWORD,
    email_confirm: true,
    ...MOCK_METADATA,
  });
  if (error) throw error;
  return data.user;
}

export async function POST() {
  try {
    if (!isMockEnabled()) {
      return Response.json({ error: "Not found." }, { status: 404 });
    }

    const user = await ensureMockUser();
    const supabaseUrl = process.env.SUPABASE_URL!;
    const browserKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
      || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
      || process.env.SUPABASE_ANON_KEY;
    if (!browserKey) throw new Error("The local Supabase browser key is missing.");

    const auth = createClient(supabaseUrl, browserKey, {
      auth: { autoRefreshToken: false, detectSessionInUrl: false, persistSession: false },
    });
    const { data, error } = await auth.auth.signInWithPassword({
      email: MOCK_EMAIL,
      password: MOCK_PASSWORD,
    });
    if (error || !data.session) throw error || new Error("The local mock user did not receive a session.");

    return Response.json(
      {
        mock: true,
        user: {
          id: user.id,
          handle: user.user_metadata.user_name,
          name: user.user_metadata.name,
        },
        session: {
          accessToken: data.session.access_token,
          refreshToken: data.session.refresh_token,
          expiresAt: data.session.expires_at,
        },
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    console.error("Local X sign-in mock failed", error);
    return Response.json(
      { error: "The local X sign-in mock could not create a Supabase session." },
      { status: 500 },
    );
  }
}
