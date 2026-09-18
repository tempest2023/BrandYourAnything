import "server-only";
import type Stripe from "stripe";
import { getDatabasePrefix } from "@/lib/database-names";
import type { AuctionOwnerCredential } from "@/lib/publishing-auth";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

export type OwnedStripeAccount = {
  id: string;
  slug: string;
  title: string;
  accountId: string | null;
  parameters: Stripe.V2.Core.AccountCreateParams | null;
  requestedAt: string | null;
  legacy: boolean;
};

export class StripeConnectError extends Error {
  constructor(public status: 400 | 404 | 409, message: string) { super(message); this.name = "StripeConnectError"; }
}

export async function ownedStripeAccount(
  slug: string,
  owner: AuctionOwnerCredential,
  action: "check" | "reserve" | "bind" | "status",
  options: {
    accountId?: string;
    parameters?: Stripe.V2.Core.AccountCreateParams;
    chargesEnabled?: boolean;
    payoutsEnabled?: boolean;
  } = {},
): Promise<OwnedStripeAccount> {
  const { data, error } = await getSupabaseAdmin().rpc(`${getDatabasePrefix()}_owned_stripe_account`, {
    p_slug: slug, p_owner_user_id: owner.ownerUserId, p_manager_key_hashes: owner.managerKeyHashCandidates,
    p_action: action, p_account_id: options.accountId ?? null, p_parameters: options.parameters ?? null,
    p_charges_enabled: options.chargesEnabled ?? false, p_payouts_enabled: options.payoutsEnabled ?? false,
  });
  if (error?.message === "stripe_account_conflict") throw new StripeConnectError(409, "The connected account changed. Refresh the dashboard.");
  if (error?.message === "auction_closed") throw new StripeConnectError(409, "This auction has closed. A new payment account cannot be created.");
  if (error) throw error;
  if (!data) throw new StripeConnectError(404, "This auction was not found or your access was revoked.");
  return data as OwnedStripeAccount;
}
