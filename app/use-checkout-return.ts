"use client";

import { useCallback, useEffect, useState } from "react";

import type { AuctionSnapshot } from "@/lib/auction";

type CheckoutFulfillment<Snapshot extends AuctionSnapshot> = {
  status: "pending" | "accepted" | "refunded" | "expired" | "failed";
  snapshot?: Snapshot;
};

export type CheckoutReturnState =
  | "idle"
  | "cancelled"
  | "confirming"
  | "accepted"
  | "refunded"
  | "expired"
  | "failed";

const RETRY_DELAYS_MS = [0, 500, 1_000, 2_000, 3_000];

function wait(delay: number) {
  return new Promise<void>((resolve) => window.setTimeout(resolve, delay));
}

function removePaymentQuery() {
  const url = new URL(window.location.href);
  url.searchParams.delete("payment");
  url.searchParams.delete("session_id");
  window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
}

export function useCheckoutReturn<Snapshot extends AuctionSnapshot>(
  applySnapshot: (snapshot: Snapshot) => void,
  expectedSlug: string,
) {
  const [state, setState] = useState<CheckoutReturnState>("idle");
  const [attempt, setAttempt] = useState(0);
  const retry = useCallback(() => setAttempt((value) => value + 1), []);

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const sessionId = query.get("session_id");
    if (query.get("payment") === "cancelled") {
      const timer = window.setTimeout(() => {
        setState("cancelled");
        removePaymentQuery();
      }, 0);
      return () => window.clearTimeout(timer);
    }
    if (query.get("payment") !== "success" || !sessionId) return;

    let cancelled = false;
    const controller = new AbortController();

    const confirmPayment = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setState("confirming");
      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) await wait(delay);
        if (cancelled) return;

        try {
          const response = await fetch(
            `/api/stripe/checkout/${encodeURIComponent(sessionId)}?auction=${encodeURIComponent(expectedSlug)}`,
            { cache: "no-store", signal: AbortSignal.any([controller.signal, AbortSignal.timeout(10_000)]) },
          );
          if (cancelled) return;
          if (!response.ok) {
            if (response.status >= 500) continue;
            setState("failed");
            return;
          }

          const result = await response.json() as CheckoutFulfillment<Snapshot>;
          if (cancelled) return;
          if (result.status === "pending") continue;
          if (!["accepted", "refunded", "expired", "failed"].includes(result.status)) continue;
          if (result.snapshot) applySnapshot(result.snapshot);
          setState(result.status);
          if (result.status !== "failed") removePaymentQuery();
          return;
        } catch {
          // A transient network failure is retried while the Stripe redirect settles.
        }
      }

      if (!cancelled) setState("failed");
    };

    void confirmPayment();
    return () => {
      cancelled = true;
      controller.abort();
    };
  }, [applySnapshot, expectedSlug, attempt]);

  return { state, retry };
}
