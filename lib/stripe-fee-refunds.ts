import "server-only";
import type Stripe from "stripe";
import { getStripe, stripeIsLive } from "@/lib/stripe";
import { paymentStripeOptions } from "@/lib/payment-work-budget";
import { recordApplicationFee, stripeEnvironment, type LaptopBidPayment } from "@/lib/stripe-bid-repository";

function id(value: string | { id: string } | null) { return typeof value === "string" ? value : value?.id; }

function verifyFee(fee: Stripe.ApplicationFee, charge: Stripe.Charge, payment: LaptopBidPayment) {
  if (id(fee.account) !== payment.stripeAccountId || id(fee.charge) !== charge.id
    || fee.livemode !== stripeIsLive() || (id(charge.application_fee) && fee.id !== id(charge.application_fee))
    || (payment.applicationFeeId && fee.id !== payment.applicationFeeId)
    || !Number.isSafeInteger(fee.amount) || fee.amount <= 0
    || !Number.isSafeInteger(fee.amount_refunded) || fee.amount_refunded < 0 || fee.amount_refunded > fee.amount
    || !/^[a-z]{3}$/.test(fee.currency)
    || fee.refunded !== (fee.amount_refunded === fee.amount)) {
    throw new Error("Application fee does not match the original charge.");
  }
}

// Customer money and the platform fee have independent completion states. This
// only processes fees for an already successful, full customer-deposit refund.
export async function reconcileApplicationFee(payment: LaptopBidPayment, refund: Stripe.Refund) {
  if (refund.status !== "succeeded") return false;
  const stripe = getStripe();
  const chargeId = id(refund.charge);
  if (!chargeId || !payment.stripeAccountId) throw new Error("Refund charge identity is missing.");
  const charge = await stripe.charges.retrieve(chargeId, {}, { ...paymentStripeOptions(), stripeAccount: payment.stripeAccountId });
  const expectedFee = Math.min(payment.depositAmountCents, Math.round(payment.bidAmountCents * 0.1));
  if (id(charge.payment_intent) !== payment.paymentIntentId || charge.id !== chargeId || !charge.paid
    || charge.livemode !== stripeIsLive() || charge.currency !== "usd" || charge.amount !== payment.depositAmountCents
    || charge.amount_captured !== payment.depositAmountCents || charge.amount_refunded !== payment.depositAmountCents
    || charge.application_fee_amount !== expectedFee) throw new Error("Fee refund charge does not match the deposit.");

  // Fees live on the platform, unlike the direct charge. Do not attach the
  // connected-account header here. Direct-charge fee creation can be delayed.
  const feeId = payment.applicationFeeId || id(charge.application_fee);
  let fee: Stripe.ApplicationFee;
  if (feeId) fee = await stripe.applicationFees.retrieve(feeId, {}, paymentStripeOptions());
  else {
    const fees = await stripe.applicationFees.list({ charge: chargeId, limit: 2 }, paymentStripeOptions());
    if (!fees.data.length) return false;
    if (fees.has_more || fees.data.length !== 1) throw new Error("Ambiguous application fee identity.");
    fee = fees.data[0];
  }
  verifyFee(fee, charge, payment);
  // Even matching currency codes do not imply matching amounts: direct charges
  // can convert to the merchant's currency and back to the platform's currency.
  // Refund the verified fee object's balance, not a recalculated USD commission.
  await recordApplicationFee(payment.id, fee.id, false);
  if (!fee.refunded) {
    try {
      // Omitting amount refunds the remaining fee. The request stays identical
      // after a partial/manual refund, and Stripe cannot refund more than remains.
      const created = await stripe.applicationFees.createRefund(fee.id, {
        metadata: { bid_payment_id: payment.id, environment: stripeEnvironment() },
      }, { ...paymentStripeOptions(), idempotencyKey: `ba-${stripeEnvironment()}-fee-refund-${payment.id}` });
      if (id(created.fee) !== fee.id || created.currency !== fee.currency || created.amount <= 0 || created.amount > fee.amount) {
        throw new Error("Application fee refund identity mismatch.");
      }
    } catch (error) {
      // A concurrent manual refund or lost response may have completed the fee.
      // A new authoritative read can acknowledge that without creating another.
      const current = await stripe.applicationFees.retrieve(fee.id, {}, paymentStripeOptions());
      verifyFee(current, charge, payment);
      if (!current.refunded) throw error;
    }
    fee = await stripe.applicationFees.retrieve(fee.id, {}, paymentStripeOptions());
    verifyFee(fee, charge, payment);
  }
  if (!fee.refunded) return false;
  await recordApplicationFee(payment.id, fee.id, true);
  return true;
}
