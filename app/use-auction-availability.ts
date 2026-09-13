"use client";

import { useEffect, useState } from "react";
import type { AuctionCampaign } from "@/lib/campaign-auction";

export function useAuctionAvailability(campaign: AuctionCampaign | undefined) {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1_000);
    window.addEventListener("focus", update);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
      window.removeEventListener("focus", update);
    };
  }, []);
  const closed = campaign?.status === "closed"
    || Boolean(campaign && now !== null && now >= Date.parse(campaign.closesAt));
  return { closed, canBid: now !== null && Boolean(campaign?.paymentsEnabled) && !closed };
}
