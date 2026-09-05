import { getAuctionSnapshot } from "@/lib/campaign-auction-repository";
import { isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ errorCode: "auction_unavailable" }, { status: 503 });
  }

  try {
    const { slug } = await context.params;
    const snapshot = await getAuctionSnapshot(slug);
    if (!snapshot) {
      return Response.json({ errorCode: "auction_not_found" }, { status: 404 });
    }
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load campaign auction", error);
    return Response.json(
      { errorCode: "auction_load_failed" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
