type SupabaseAuthSettings = {
  external?: {
    x?: unknown;
  };
};

export const dynamic = "force-dynamic";

const NO_STORE_HEADERS = { "Cache-Control": "no-store, max-age=0" };

export async function GET() {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
    || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !supabaseKey) {
    return Response.json({ configured: false }, { headers: NO_STORE_HEADERS });
  }

  try {
    const response = await fetch(`${supabaseUrl.replace(/\/+$/, "")}/auth/v1/settings`, {
      headers: { apikey: supabaseKey },
      cache: "no-store",
      signal: AbortSignal.timeout(5_000),
    });
    if (!response.ok) throw new Error(`Supabase Auth settings returned ${response.status}.`);
    const settings = await response.json() as SupabaseAuthSettings;
    return Response.json(
      { configured: settings.external?.x === true },
      { headers: NO_STORE_HEADERS },
    );
  } catch (error) {
    console.error("Failed to check X authentication availability", error);
    return Response.json(
      { error: "X authentication availability could not be checked." },
      { status: 503, headers: NO_STORE_HEADERS },
    );
  }
}
