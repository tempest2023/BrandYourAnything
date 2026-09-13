import "server-only";

import type Stripe from "stripe";

import {
  getDatabasePrefix,
  getLaptopBidPaymentTable,
  getLaptopTable,
  getSettleLaptopBidPaymentFunction,
} from "@/lib/database-names";
import type { LaptopBidPaymentStatus } from "@/lib/laptop";
import { getSupabaseAdmin } from "@/lib/supabase-admin";

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


export type LaptopBidPayment = {
  assetVersion: string | null;
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
  stripeAccountId: string | null;
  checkoutParameters: Stripe.Checkout.SessionCreateParams | null;
  createdAt: string;
  refundId: string | null;
  refundStatus: string | null;
  checkoutRequestVersion: number;
};

type LaptopBidPaymentRow = {
  asset_version: string | null;
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
  stripe_account_id: string | null;
  checkout_parameters: Stripe.Checkout.SessionCreateParams | null;
  created_at: string;
  stripe_refund_id: string | null;
  refund_status: string | null;
  checkout_request_version: number;
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

const PAYMENT_COLUMNS = "asset_version,id,laptop_id,spot_position,bid_amount_cents,deposit_amount_cents,bidder_name,bidder_email,website,x_handle,logo_storage_path,idempotency_key,stripe_checkout_session_id,stripe_payment_intent_id,previous_payment_intent_id,status,failure_reason,stripe_account_id,checkout_parameters,created_at,stripe_refund_id,refund_status,checkout_request_version";

function mapPayment(row: LaptopBidPaymentRow): LaptopBidPayment {
  return {
    assetVersion: row.asset_version,
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
    stripeAccountId: row.stripe_account_id,
    checkoutParameters: row.checkout_parameters,
    createdAt: row.created_at,
    refundId: row.stripe_refund_id,
    refundStatus: row.refund_status,
    checkoutRequestVersion: row.checkout_request_version,
  };
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

export async function hasCampaignForStripeAccount(accountId: string) {
  const { data, error } = await getSupabaseAdmin().from(getLaptopTable("laptops"))
    .select("id").eq("stripe_account_id", accountId).limit(1);
  if (error) throw error;
  return Boolean(data?.length);
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
  assetVersion?: string | null;
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
  stripeAccountId: string;
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
        asset_version: input.assetVersion ?? null,
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
        stripe_account_id: input.stripeAccountId,
      })
      .select(PAYMENT_COLUMNS)
      .single();
    if (error) {
      if (error.code === "23505") {
        // Only an idempotency race is recoverable; never recursively retry an
        // unrelated uniqueness violation indefinitely.
        const existing = await getBidPaymentByIdempotencyKey(input.idempotencyKey);
        if (existing) return assertPaymentMatches(existing, input);
      }
      throw error;
    }
    row = data as LaptopBidPaymentRow;
  }

  return assertPaymentMatches(mapPayment(row), input);
}

export function assertPaymentMatches(payment: LaptopBidPayment, input: Omit<CreateBidPaymentInput, "stripeAccountId">) {
  const matches = payment.laptopId === input.laptopId
    && payment.assetVersion === (input.assetVersion ?? null)
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

export async function getBidPaymentByIdempotencyKey(key: string) {
  const { data, error } = await getSupabaseAdmin().from(getLaptopBidPaymentTable())
    .select(PAYMENT_COLUMNS).eq("idempotency_key", key).maybeSingle();
  if (error) throw error;
  return data ? mapPayment(data as LaptopBidPaymentRow) : null;
}

export async function saveCheckoutParameters(paymentId: string, parameters: Stripe.Checkout.SessionCreateParams) {
  const { data, error } = await getSupabaseAdmin().from(getLaptopBidPaymentTable())
    .update({ checkout_parameters: parameters }).eq("id", paymentId).is("checkout_parameters", null)
    .select(PAYMENT_COLUMNS).maybeSingle();
  if (error) throw error;
  const payment = data ? mapPayment(data as LaptopBidPaymentRow) : await getBidPaymentById(paymentId);
  if (!payment?.checkoutParameters) throw new Error("Checkout parameters were not saved.");
  return payment.checkoutParameters;
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
  const existing = await getBidPaymentById(paymentId);
  if (!existing || existing.checkoutSessionId !== checkoutSessionId) throw new Error("Checkout attachment conflict.");
  return existing;
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

export async function getStripeAuctionForPayment(laptopId: string) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopTable("laptops"))
    .select("stripe_account_id,slug")
    .eq("id", laptopId)
    .maybeSingle();
  if (error) throw error;
  return data as { stripe_account_id: string | null; slug: string } | null;
}

export async function getStripeAuctionBySlug(slug: string) {
  const { data, error } = await getSupabaseAdmin().from(getLaptopTable("laptops"))
    .select("stripe_account_id,slug").eq("slug", slug.toLowerCase()).maybeSingle();
  if (error) throw error;
  return data as { stripe_account_id: string | null; slug: string } | null;
}

export async function markBidPaymentPaid(
  paymentId: string,
  checkoutSessionId: string,
  paymentIntentId: string,
) {
  const { data, error } = await getSupabaseAdmin()
    .from(getLaptopBidPaymentTable())
    .update({
      stripe_checkout_session_id: checkoutSessionId,
      stripe_payment_intent_id: paymentIntentId,
      status: "paid",
      failure_reason: null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", paymentId)
    .eq("stripe_checkout_session_id", checkoutSessionId)
    .in("status", ["pending", "paid"])
    .select(PAYMENT_COLUMNS).maybeSingle();
  if (error) throw error;
  return data ? mapPayment(data as LaptopBidPaymentRow) : getBidPaymentById(paymentId);
}

export async function expirePendingPayment(paymentId: string) {
  const { data, error } = await getSupabaseAdmin().from(getLaptopBidPaymentTable())
    .update({ status: "expired", failure_reason: "checkout_expired", updated_at: new Date().toISOString() })
    .eq("id", paymentId).eq("status", "pending").select("id").maybeSingle();
  if (error) throw error;
  return Boolean(data);
}

export async function recordRefund(paymentId: string, refund: Stripe.Refund) {
  const succeeded = refund.status === "succeeded";
  const { error } = await getSupabaseAdmin().from(getLaptopBidPaymentTable())
    .update({ stripe_refund_id: refund.id, refund_status: refund.status,
      status: succeeded ? "refunded" : "refund_pending", updated_at: new Date().toISOString() })
    .eq("id", paymentId).eq("status", "refund_pending");
  if (error) throw error;
}

export async function compensateLatePayment(paymentId: string, intentId: string) {
  const { error } = await getSupabaseAdmin().from(getLaptopBidPaymentTable())
    .update({ status: "refund_pending", stripe_payment_intent_id: intentId, failure_reason: "payment_rejected", updated_at: new Date().toISOString() })
    .eq("id", paymentId).in("status", ["expired", "failed"]);
  if (error) throw error;
}

export type PaymentRecoveryWork = LaptopBidPayment & { leaseToken: string; attempts: number };

export async function claimPaymentWork(kind: "payment" | "refund", scope: { laptopId?: string; paymentId?: string } = {}): Promise<PaymentRecoveryWork | null> {
  const { data, error } = await getSupabaseAdmin().rpc(`${getDatabasePrefix()}_claim_payment_work`, {
    p_kind: kind, p_laptop_id: scope.laptopId ?? null, p_payment_id: scope.paymentId ?? null,
  });
  if (error) throw error;
  if (!data) return null;
  return { ...mapPayment(data), leaseToken: data.reconcile_token, attempts: data.reconcile_attempts };
}

export async function finishPaymentWork(work: PaymentRecoveryWork, errorCode: string | null, retrySeconds = 60) {
  const delay = errorCode ? Math.min(3600, 60 * 2 ** Math.min(work.attempts - 1, 6)) : retrySeconds;
  const { error } = await getSupabaseAdmin().from(getLaptopBidPaymentTable()).update({
    reconcile_after: new Date(Date.now() + delay * 1000).toISOString(), reconcile_last_error: errorCode,
    reconcile_token: null, reconcile_lease_until: null,
  }).eq("id", work.id).eq("reconcile_token", work.leaseToken);
  if (error) throw error;
}

export async function listRefundPendingPayments(laptopId?: string, limit = 50) {
  let query = getSupabaseAdmin().from(getLaptopBidPaymentTable())
    .select(PAYMENT_COLUMNS).eq("status", "refund_pending").order("updated_at", { ascending: true }).limit(limit);
  if (laptopId) query = query.eq("laptop_id", laptopId);
  const { data, error } = await query;
  if (error) throw error;
  return (data as LaptopBidPaymentRow[]).map(mapPayment);
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
