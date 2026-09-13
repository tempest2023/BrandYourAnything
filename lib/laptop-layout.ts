import type { Spot } from "@/lib/auction";
import type { SpotLayoutItem } from "@/lib/surface-spots";
import { SPOT_NAME_KEYS } from "@/lib/i18n";

export function appendLogoCoverSpot(layout: SpotLayoutItem[], amountUsd: number): SpotLayoutItem[] {
  return [...layout, { id: layout.length + 1, name: "Over the Apple logo", size: "L",
    dimensions: "6 × 6 cm", openingBidCents: Math.round(amountUsd * 100), logoCover: true }];
}

export function laptopBaseSpotCount(spots: Pick<Spot, "logoCover">[]) {
  return spots.filter((spot) => !spot.logoCover).length;
}

export function laptopSpotNameKey(spot: Pick<Spot, "id" | "logoCover">, spots: Pick<Spot, "logoCover">[]) {
  if (spot.logoCover) return "common.logoCover" as const;
  const id = laptopBaseSpotCount(spots) === 6 ? [1, 3, 4, 7, 8, 10][spot.id - 1] : spot.id;
  return SPOT_NAME_KEYS[id];
}
