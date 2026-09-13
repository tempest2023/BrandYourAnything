import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import type Stripe from "stripe";

type Budget = { deadline: number; signal: AbortSignal };
const budgets = new AsyncLocalStorage<Budget>();

export function paymentWorkRemaining() {
  return Math.max(0, (budgets.getStore()?.deadline ?? Infinity) - Date.now());
}

export async function withPaymentWorkBudget<T>(work: () => Promise<T>, durationMs = 40_000): Promise<T> {
  if (budgets.getStore()) return work();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException("Payment recovery deadline exceeded.", "AbortError")), durationMs);
  // Await inside the context as well: database builders are lazy thenables and
  // only start their request when awaited, not when the callback returns them.
  try { return await budgets.run({ deadline: Date.now() + durationMs, signal: controller.signal }, async () => await work()); }
  finally { clearTimeout(timer); }
}

export function paymentStripeOptions(): Stripe.RequestOptions {
  const remaining = paymentWorkRemaining();
  if (!Number.isFinite(remaining)) return {};
  if (remaining <= 0) throw new Error("Payment recovery deadline exceeded.");
  return { timeout: Math.min(5_000, remaining), maxNetworkRetries: 0 };
}

// The signal remains active while the response body is consumed. This bounds
// both Stripe and database traffic, not just the time to receive HTTP headers.
// AsyncLocalStorage keeps concurrent ordinary requests outside this job budget.
export const paymentWorkFetch: typeof fetch = async (input, init) => {
  const budget = budgets.getStore();
  if (!budget) return fetch(input, init);
  budget.signal.throwIfAborted();
  const signals = [budget.signal, AbortSignal.timeout(Math.max(1, Math.min(5_000, paymentWorkRemaining())))];
  const originalSignal = init?.signal ?? (input instanceof Request ? input.signal : null);
  if (originalSignal) signals.push(originalSignal);
  const signal = AbortSignal.any(signals);
  try { return await fetch(input, { ...init, signal }); }
  catch (error) {
    // PostgREST retries generic network errors, but not AbortError. Preserve the
    // cancellation semantics of both total deadlines and per-request timeouts.
    if (signal.aborted) throw new DOMException("Payment recovery request aborted.", "AbortError");
    throw error;
  }
};
