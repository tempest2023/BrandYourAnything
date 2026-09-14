import { getAuctionSnapshot } from "@/lib/campaign-auction-repository";
import { DEFAULT_AUCTION_SLUG } from "@/lib/site";
import { isSupabaseConfigured } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!isSupabaseConfigured()) {
    return Response.json(
      { error: "Auction backend is not configured." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }

  try {
    const snapshot = await getAuctionSnapshot(DEFAULT_AUCTION_SLUG);
    if (!snapshot) {
      return Response.json(
        { error: "Default auction was not found." },
        { status: 404, headers: { "Cache-Control": "no-store" } },
      );
    }
    return Response.json(snapshot, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("Failed to load auction data", error);
    return Response.json(
      { error: "Auction data is temporarily unavailable." },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  }
}
