import type { Spot } from "@/lib/auction";

/**
 * Signed Storage URLs are re-minted on every server render, so the same logo
 * reaches the browser as a different URL on each poll. Reusing the URL already
 * handed out keeps the image (and any image cache) from refetching it. The hold
 * expires well before the signed token's one hour lifetime, so a long-lived tab
 * still picks up a fresh token.
 */
export const SPOT_LOGO_URL_MAX_AGE_MS = 30 * 60 * 1000;

export type SpotLogoCache = Map<string, { url: string; heldAt: number }>;

export function createSpotLogoCache(): SpotLogoCache {
  return new Map();
}

export function stabilizeSpotLogoUrls(spots: Spot[], cache: SpotLogoCache, now = Date.now()): Spot[] {
  const active = new Set<string>();
  const stabilized = spots.map((spot) => {
    if (!spot.logoKey || !spot.logo) return spot;
    active.add(spot.logoKey);

    const held = cache.get(spot.logoKey);
    if (held && now - held.heldAt < SPOT_LOGO_URL_MAX_AGE_MS) {
      return spot.logo === held.url ? spot : { ...spot, logo: held.url };
    }

    cache.set(spot.logoKey, { url: spot.logo, heldAt: now });
    return spot;
  });

  for (const key of cache.keys()) {
    if (!active.has(key)) cache.delete(key);
  }
  return stabilized;
}
