import "server-only";

import {
  getDatabasePrefix,
  getLaptopBidPaymentTable,
  getLaptopTable,
  getSettleLaptopBidPaymentFunction,
} from "@/lib/database-names";
import type { LaptopBidPaymentStatus } from "@/lib/laptop";
import { getSupabaseAdmin } from "@/lib/supabase-admin";
import type { AuctionOwnerCredential } from "@/lib/x-auth";

type LaptopPaymentRow = {
  id: string;
  slug: string;
  owner_email: string;
  owner_user_id: string | null;
  manager_key_hash: string | null;
  title: string;
  auction_closes_at: string;
  status: "published" | "closed";
  stripe_account_id: string | null;
  stripe_charges_enabled: boolean;
  stripe_payouts_enabled: boolean;
};

type LaptopSpotPaymentRow = {
  position: number;
  name: string;
  opening_bid_cents: number;
  min_increment_cents: number;
  current_bid_cents: number | null;
};

export type StripeBidContext = {
  laptopId: string;
  slug: string;
  title: string;
  spotName: string;
  spotPosition: number;
  minimumBidCents: number;
  stripeAccountId: string;
};

export type StripeCampaignAccount = {
  id: string;
  slug: string;
  title: string;
  stripeAccountId: string | null;
  chargesEnabled: boolean;
  payoutsEnabled: boolean;
};

export type LaptopBidPayment = {
  id: string;
  laptopId: string;
  spotPosition: number;
  bidAmountCents: number;
  depositAmountCents: number;
  bidderName: string;
  bidderEmail: string;
  website: string | null;
  xHandle: string | null;
  logoStoragePath: string | null;
  idempotencyKey: string;
  checkoutSessionId: string | null;
  paymentIntentId: string | null;
  previousPaymentIntentId: string | null;
  status: LaptopBidPaymentStatus;
  failureReason: string | null;
};

type LaptopBidPaymentRow = {
  id: string;
  laptop_id: string;
  spot_position: number;
  bid_amount_cents: number;
  deposit_amount_cents: number;
  bidder_name: string;
  bidder_email: string;
  website: string | null;
  x_handle: string | null;
  logo_storage_path: string | null;
  idempotency_key: string;
  stripe_checkout_session_id: string | null;
  stripe_payment_intent_id: string | null;
  previous_payment_intent_id: string | null;
  status: LaptopBidPaymentStatus;
  failure_reason: string | null;
};

type SettlePaymentRow = {
  accepted: boolean;
  reason: string;
  current_bid_cents: number;
  minimum_next_bid_cents: number;
  current_bidder_name: string;
  bid_count: number;
  previous_payment_intent_id: string | null;
  bid_id: string | null;
};

const PAYMENT_COLUMNS = "id,laptop_id,spot_position,bid_amount_cents,deposit_amount_cents,bidder_name,bidder_email,website,x_handle,logo_storage_path,idempotency_key,stripe_checkout_session_id,stripe_payment_intent_id,previous_payment_intent_id,status,failure_reason";

function mapPayment(row: LaptopBidPaymentRow): LaptopBidPayment {
  return {
    id: row.id,
    laptopId: row.laptop_id,
    spotPosition: row.spot_position,
    bidAmountCents: Number(row.bid_amount_cents),
    depositAmountCents: Number(row.deposit_amount_cents),
    bidderName: row.bidder_name,
    bidderEmail: row.bidder_email,
    website: row.website,
    xHandle: row.x_handle,
    logoStoragePath: row.logo_storage_path,
    idempotencyKey: row.idempotency_key,
    checkoutSessionId: row.stripe_checkout_session_id,
    paymentIntentId: row.stripe_payment_intent_id,
    previousPaymentIntentId: row.previous_payment_intent_id,
    status: row.status,
    failureReason: row.failure_reason,
  };
}

export async function getOwnedStripeCampaign(slug: string, owner: AuctionOwnerCredential) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .select("id,slug,owner_email,owner_user_id,manager_key_hash,title,auction_closes_at,status,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const row = data as LaptopPaymentRow;
  const ownedByUser = Boolean(owner.ownerUserId && row.owner_user_id === owner.ownerUserId);
  const ownedByManager = Boolean(
    row.manager_key_hash
    && owner.managerKeyHashCandidates.includes(row.manager_key_hash),
  );
  if (!ownedByUser && !ownedByManager) return null;
  return {
    id: row.id,
    slug: row.slug,
    title: row.title,
    stripeAccountId: row.stripe_account_id,
    chargesEnabled: row.stripe_charges_enabled,
    payoutsEnabled: row.stripe_payouts_enabled,
  } satisfies StripeCampaignAccount;
}

export async function setStripeCampaignAccount(
  laptopId: string,
  accountId: string,
  chargesEnabled: boolean,
  payoutsEnabled: boolean,
) {
  const { error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .update({
      stripe_account_id: accountId,
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq("id", laptopId);
  if (error) throw error;
}

export async function updateCampaignsForStripeAccount(
  accountId: string,
  chargesEnabled: boolean,
  payoutsEnabled: boolean,
) {
  const { error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .update({
      stripe_charges_enabled: chargesEnabled,
      stripe_payouts_enabled: payoutsEnabled,
      updated_at: new Date().toISOString(),
    })
    .eq("stripe_account_id", accountId);
  if (error) throw error;
}

export async function getStripeBidContext(
  slug: string,
  spotPosition: number,
): Promise<StripeBidContext | null> {
  const supabase = getSupabaseAdmin();
  const { data: laptopData, error: laptopError } = await supabase
    .from(getLaptopTable("laptops"))
    .select("id,slug,owner_email,title,auction_closes_at,status,stripe_account_id,stripe_charges_enabled,stripe_payouts_enabled")
    .eq("slug", slug.toLowerCase())
    .maybeSingle();
  if (laptopError) throw laptopError;
  if (!laptopData) return null;

  const laptop = laptopData as LaptopPaymentRow;
  if (laptop.status !== "published" || Date.now() >= new Date(laptop.auction_closes_at).getTime()) {
    throw new Error("auction_closed");
  }
  if (!laptop.stripe_account_id || !laptop.stripe_charges_enabled || !laptop.stripe_payouts_enabled) {
    throw new Error("payments_not_ready");
  }

  const { data: spotData, error: spotError } = await supabase
    .from(getLaptopTable("laptop_spots"))
    .select("position,name,opening_bid_cents,min_increment_cents,current_bid_cents")
    .eq("laptop_id", laptop.id)
    .eq("position", spotPosition)
    .maybeSingle();
  if (spotError) throw spotError;
  if (!spotData) return null;
  const spot = spotData as LaptopSpotPaymentRow;
  const minimumBidCents = spot.current_bid_cents === null
    ? Number(spot.opening_bid_cents)
    : Number(spot.current_bid_cents) + Number(spot.min_increment_cents);

  return {
    laptopId: laptop.id,
    slug: laptop.slug,
    title: laptop.title,
    spotName: spot.name,
    spotPosition: spot.position,
    minimumBidCents,
    stripeAccountId: laptop.stripe_account_id,
  };
}

export type CreateBidPaymentInput = {
  laptopId: string;
  spotPosition: number;
  bidAmountCents: number;
  depositAmountCents: number;
  bidderName: string;
  bidderEmail: string;
  website: string | null;
  xHandle: string | null;
  logoStoragePath: string | null;
  idempotencyKey: string;
};

export async function createOrGetBidPayment(input: CreateBidPaymentInput) {
  const supabase = getSupabaseAdmin();
  const { data: existingData, error: existingError } = await supabase
    .from(getLaptopBidPaymentTable())
    .select(PAYMENT_COLUMNS)
    .eq("idempotency_key", input.idempotencyKey)
    .maybeSingle();
  if (existingError) throw existingError;

  let row = existingData as LaptopBidPaymentRow | null;
  if (!row) {
    const { data, error } = await supabase
      .from(getLaptopBidPaymentTable())
      .insert({
        laptop_id: input.laptopId,
        spot_position: input.spotPosition,
        bid_amount_cents: input.bidAmountCents,
        deposit_amount_cents: input.depositAmountCents,
        bidder_name: input.bidderName,
        bidder_email: input.bidderEmail,
        website: input.website,
        x_handle: input.xHandle,
        logo_storage_path: input.logoStoragePath,
        idempotency_key: input.idempotencyKey,
      })
      .select(PAYMENT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") return createOrGetBidPayment(input);
      throw error;
    }
    row = data as LaptopBidPaymentRow;
  }

  const payment = mapPayment(row);
  const matches = payment.laptopId === input.laptopId
    && payment.spotPosition === input.spotPosition
    && payment.bidAmountCents === input.bidAmountCents
    && payment.depositAmountCents === input.depositAmountCents
    && payment.bidderName === input.bidderName
    && payment.bidderEmail === input.bidderEmail
    && payment.website === input.website
    && payment.xHandle === input.xHandle
    && payment.logoStoragePath === input.logoStoragePath;
  if (!matches) throw new Error("idempotency_conflict");
  return payment;
}

export async function attachCheckoutSession(paymentId: string, checkoutSessionId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .update({ stripe_checkout_session_id: checkoutSessionId, updated_at: new Date().toISOString() })
    .eq("id", paymentId)
    .is("stripe_checkout_session_id", null)
    .select(PAYMENT_COLUMNS)
    .maybeSingle();
  if (error) throw error;
  if (data) return mapPayment(data as LaptopBidPaymentRow);
  return getBidPaymentById(paymentId);
}

export async function getBidPaymentById(paymentId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .select(PAYMENT_COLUMNS)
    .eq("id", paymentId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPayment(data as LaptopBidPaymentRow) : null;
}

export async function getBidPaymentBySessionId(checkoutSessionId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .select(PAYMENT_COLUMNS)
    .eq("stripe_checkout_session_id", checkoutSessionId)
    .maybeSingle();
  if (error) throw error;
  return data ? mapPayment(data as LaptopBidPaymentRow) : null;
}

export async function getStripeAccountIdForLaptop(laptopId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .select("stripe_account_id")
    .eq("id", laptopId)
    .maybeSingle();
  if (error) throw error;
  return (data?.stripe_account_id as string | null | undefined) ?? null;
}

export async function markBidPaymentPaid(
  paymentId: string,
  checkoutSessionId: string,
  paymentIntentId: string,
) {
  const { error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .update({
      stripe_checkout_session_id: checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .in("status", ["pending", "paid"]);
  if (error) throw error;
}

export async function markBidPaymentStatus(
  paymentId: string,
  status: LaptopBidPaymentStatus,
  failureReason: string | null = null,
) {
  const { error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .update({ status, failure_reason: failureReason, updated_at: new Date().toISOString() })
    .eq("id", paymentId);
  if (error) throw error;
}

export async function markPaymentIntentRefunded(paymentIntentId: string, reason: string) {
  const { error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .update({ status: "refunded", failure_reason: reason, updated_at: new Date().toISOString() })
    .eq("stripe_payment_intent_id", paymentIntentId);
  if (error) throw error;
}

export async function settleLaptopBidPayment(paymentId: string) {
  const { data, error } = await getSupabaseAdmin().rpc(getSettleLaptopBidPaymentFunction(), {
    p_payment_id: paymentId,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as SettlePaymentRow | undefined;
  if (!row) throw new Error("The database returned no result for paid bid settlement.");
  return {
    accepted: row.accepted,
    reason: row.reason,
    currentBid: Number(row.current_bid_cents) / 100,
    minimumNextBid: Number(row.minimum_next_bid_cents) / 100,
    currentBidderName: row.current_bidder_name,
    bidCount: row.bid_count,
    previousPaymentIntentId: row.previous_payment_intent_id,
    bidId: row.bid_id,
  };
}

export function stripeEnvironment() {
  return getDatabasePrefix().replace(/^ba_/, "");
}
