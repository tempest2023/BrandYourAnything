"use client";

import { useEffect, useState } from "react";

import type { AuctionSnapshot } from "@/lib/auction";

type CheckoutFulfillment<Snapshot extends AuctionSnapshot> = {
  status: "pending" | "accepted" | "refunded" | "expired" | "failed";
  snapshot?: Snapshot;
};

export type CheckoutReturnState =
  | "idle"
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
) {
  const [state, setState] = useState<CheckoutReturnState>("idle");

  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const sessionId = query.get("session_id");
    if (query.get("payment") !== "success" || !sessionId) return;

    let cancelled = false;

    const confirmPayment = async () => {
      await Promise.resolve();
      if (cancelled) return;
      setState("confirming");
      for (const delay of RETRY_DELAYS_MS) {
        if (delay > 0) await wait(delay);
        if (cancelled) return;

        try {
          const response = await fetch(
            `/api/stripe/checkout/${encodeURIComponent(sessionId)}`,
            { cache: "no-store" },
          );
          if (!response.ok) {
            if (response.status >= 500) continue;
            setState("failed");
            removePaymentQuery();
            return;
          }

          const result = await response.json() as CheckoutFulfillment<Snapshot>;
          if (result.status === "pending") continue;
          if (result.snapshot) applySnapshot(result.snapshot);
          setState(result.status);
          removePaymentQuery();
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
    };
  }, [applySnapshot]);

  return state;
}
