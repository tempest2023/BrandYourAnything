import { listXOwnedAuctions } from "@/lib/auction-ownership";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import { getXOwner, XAuthenticationError } from "@/lib/x-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auction management is temporarily unavailable." }, { status: 503 });
  }
  try {
    const owner = await getXOwner(request);
    return Response.json(
      { auctions: await listXOwnedAuctions(owner) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof XAuthenticationError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    console.error("Failed to list owned auctions", error);
    return Response.json({ error: "Your auctions could not be loaded." }, { status: 500 });
  }
}
