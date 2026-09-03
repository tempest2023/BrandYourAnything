"use client";

import { useEffect, useState } from "react";

import {
  MANAGED_AUCTIONS_CHANGE_EVENT,
  MANAGED_AUCTIONS_STORAGE_KEY,
  loadManagedAuctions,
} from "@/lib/managed-auctions";
import { getSupabaseBrowser, isSupabaseBrowserConfigured } from "@/lib/supabase-browser";

type OwnedAuctionsPayload = {
  auctions?: unknown[];
};

export function useHasManagedAuctions() {
  const [hasManagedAuctions, setHasManagedAuctions] = useState(false);

  useEffect(() => {
    let active = true;
    let requestVersion = 0;
    let hasBrowserAuctions = false;
    let hasXAuctions = false;

    const commit = () => {
      if (active) setHasManagedAuctions(hasBrowserAuctions || hasXAuctions);
    };

    const refreshBrowserAuctions = () => {
      hasBrowserAuctions = loadManagedAuctions().length > 0;
      commit();
    };

    const refreshXAuctions = async (accessToken: string | null) => {
      const version = ++requestVersion;
      if (!accessToken) {
        hasXAuctions = false;
        commit();
        return;
      }

      try {
        const response = await fetch("/api/laptops/mine", {
          headers: { Authorization: `Bearer ${accessToken}` },
          cache: "no-store",
        });
        const payload = await response.json() as OwnedAuctionsPayload;
        if (!active || version !== requestVersion) return;
        hasXAuctions = response.ok && Array.isArray(payload.auctions) && payload.auctions.length > 0;
      } catch {
        if (!active || version !== requestVersion) return;
        hasXAuctions = false;
      }
      commit();
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || event.key === MANAGED_AUCTIONS_STORAGE_KEY) refreshBrowserAuctions();
    };

    refreshBrowserAuctions();
    window.addEventListener("storage", handleStorage);
    window.addEventListener(MANAGED_AUCTIONS_CHANGE_EVENT, refreshBrowserAuctions);

    if (!isSupabaseBrowserConfigured()) {
      return () => {
        active = false;
        window.removeEventListener("storage", handleStorage);
        window.removeEventListener(MANAGED_AUCTIONS_CHANGE_EVENT, refreshBrowserAuctions);
      };
    }

    const supabase = getSupabaseBrowser();
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      void refreshXAuctions(session?.access_token ?? null);
    });
    void supabase.auth.getSession().then(({ data }) => {
      void refreshXAuctions(data.session?.access_token ?? null);
    });

    return () => {
      active = false;
      requestVersion += 1;
      listener.subscription.unsubscribe();
      window.removeEventListener("storage", handleStorage);
      window.removeEventListener(MANAGED_AUCTIONS_CHANGE_EVENT, refreshBrowserAuctions);
    };
  }, []);

  return hasManagedAuctions;
}
