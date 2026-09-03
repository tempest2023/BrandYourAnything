import {
  claimAuctionForX,
  closeOwnedAuction,
  getOwnedAuction,
  setAuctionRecoveryForX,
} from "@/lib/auction-ownership";
import { isSupabaseConfigured } from "@/lib/supabase-admin";
import {
  getManagerCredential,
  getManagerCredentialFromValue,
  getPublishingOwner,
  getXOwner,
  XAuthenticationError,
} from "@/lib/x-auth";

export const runtime = "nodejs";

function authenticationError(error: unknown) {
  if (!(error instanceof XAuthenticationError)) return null;
  return Response.json({ error: error.message }, { status: error.status });
}

export async function GET(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auction management is temporarily unavailable." }, { status: 503 });
  }
  try {
    const { slug } = await context.params;
    const owner = await getPublishingOwner(request);
    const auction = await getOwnedAuction(slug, owner);
    if (!auction) return Response.json({ error: "This auction was not found." }, { status: 404 });
    return Response.json({ auction }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const response = authenticationError(error);
    if (response) return response;
    console.error("Failed to read auction management state", error);
    return Response.json({ error: "Auction management could not be loaded." }, { status: 500 });
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auction management is temporarily unavailable." }, { status: 503 });
  }
  try {
    const { slug } = await context.params;
    const [manager, xOwner] = await Promise.all([
      Promise.resolve(getManagerCredential(request)),
      getXOwner(request),
    ]);
    const auction = await claimAuctionForX(slug, manager, xOwner);
    if (!auction) return Response.json({ error: "This recovery code does not own the auction." }, { status: 404 });
    return Response.json({ auction });
  } catch (error) {
    const response = authenticationError(error);
    if (response) return response;
    if (error instanceof Error && error.message === "auction_claimed_by_another_user") {
      return Response.json({ error: "This auction is already claimed by another X account." }, { status: 409 });
    }
    console.error("Failed to claim auction", error);
    return Response.json({ error: "The auction could not be claimed." }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ slug: string }> },
) {
  if (!isSupabaseConfigured()) {
    return Response.json({ error: "Auction management is temporarily unavailable." }, { status: 503 });
  }
  try {
    const body = await request.json() as {
      status?: unknown;
      recoveryAction?: unknown;
      recoveryCode?: unknown;
    };
    const { slug } = await context.params;
    if (body.status === "closed") {
      const owner = await getPublishingOwner(request);
      const auction = await closeOwnedAuction(slug, owner);
      if (!auction) return Response.json({ error: "This auction was not found." }, { status: 404 });
      return Response.json({ auction });
    }
    if (body.recoveryAction === "disable" || body.recoveryAction === "rotate") {
      const xOwner = await getXOwner(request);
      const nextManagerHash = body.recoveryAction === "rotate"
        ? getManagerCredentialFromValue(typeof body.recoveryCode === "string" ? body.recoveryCode : "").managerKeyHash
        : null;
      const auction = await setAuctionRecoveryForX(slug, xOwner, nextManagerHash);
      if (!auction) return Response.json({ error: "This auction was not found." }, { status: 404 });
      return Response.json({ auction });
    }
    return Response.json({ error: "This management action is not supported." }, { status: 400 });
  } catch (error) {
    const response = authenticationError(error);
    if (response) return response;
    console.error("Failed to close auction", error);
    return Response.json({ error: "The auction could not be closed." }, { status: 500 });
  }
}
