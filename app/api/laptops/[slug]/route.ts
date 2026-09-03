import { getLaptopSnapshot } from "@/lib/laptop-repository";
import { isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auctions are temporarily unavailable." }, { status: 503 });
  }

  try {
    const { slug } = await context.params;
    const snapshot = await getLaptopSnapshot(slug);
    if (!snapshot) {
      return Response.json({ error: "This auction does not exist." }, { status: 404 });
    }
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load campaign auction", error);
    return Response.json(
      { error: "This auction could not be loaded. Please try again." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
