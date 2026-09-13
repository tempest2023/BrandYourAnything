import { timingSafeEqual } from "node:crypto";
import { reconcileStripePayments } from "@/lib/stripe-bids";
import { isStripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function GET(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || !isStripeConfigured()) return Response.json({ error: "Payment reconciliation is not configured." }, { status: 503 });
  const expected = Buffer.from(`Bearer ${secret}`);
  const provided = Buffer.from(request.headers.get("authorization") || "");
  if (provided.length !== expected.length || !timingSafeEqual(provided, expected)) return Response.json({ error: "Unauthorized." }, { status: 401 });
  try {
    const result = await reconcileStripePayments();
    return Response.json(result, { status: result.failed.length ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return Response.json({ error: "Payment reconciliation could not finish. Retry is safe." }, { status: 503 });
  }
}

export const POST = GET;
