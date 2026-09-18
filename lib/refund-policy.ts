// Refunds are handled manually by an operator in the Stripe Dashboard while the
// payment flow is being validated.
//
// The auction still records the obligation: a payment that should be returned
// moves to `refund_pending` and stays visible in the recovery backlog, but the
// application never creates or completes a Stripe refund — and therefore never
// reconciles the application fee — on its own.
//
// Flip this back to `true` to re-enable the automated refund engine. The queue,
// the Stripe contract checks and the tests for it all remain in place.
//
// `ENABLE_AUTOMATIC_REFUNDS=1` turns the engine back on for a deployment (the
// paid-flow E2E uses it to keep covering the engine itself). Leave it unset to
// keep refunds manual.
export const AUTOMATIC_REFUNDS_ENABLED = process.env.ENABLE_AUTOMATIC_REFUNDS === "1";
