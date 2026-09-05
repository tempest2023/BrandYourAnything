export const MIN_SURFACE_SPOTS = 1;
export const MAX_SURFACE_SPOTS = 20;

export type SurfaceVector = [number, number, number];

export type SurfaceSpotPlacement = {
  id: number;
  position: SurfaceVector;
  normal: SurfaceVector;
};

export type SurfaceModelAnalysis = {
  recommendedCount: number;
  usableSideArea: number;
  placements: SurfaceSpotPlacement[];
};

export type SpotLayoutItem = {
  id: number;
  name: string;
  size: "S" | "M" | "L";
  dimensions: string;
  openingBidCents: number;
  position?: SurfaceVector;
  normal?: SurfaceVector;
};

export type SurfacePlacementProfile = "car" | "yacht" | "jet" | "generic";

export const RECOMMENDED_SURFACE_SPOTS: Record<SurfacePlacementProfile, number> = {
  car: 5,
  yacht: 6,
  jet: 6,
  generic: 8,
};

export function clampSurfaceSpotCount(value: number) {
  if (!Number.isFinite(value)) return MIN_SURFACE_SPOTS;
  return Math.min(MAX_SURFACE_SPOTS, Math.max(MIN_SURFACE_SPOTS, Math.round(value)));
}

export function surfaceSpotSize(index: number, count: number): "S" | "M" | "L" {
  const largeCount = Math.max(1, Math.round(count * 0.3));
  const mediumCount = Math.max(1, Math.round(count * 0.3));
  if (index < largeCount) return "L";
  if (index < largeCount + mediumCount) return "M";
  return "S";
}

export function surfaceSpotName(spot: SurfaceSpotPlacement, index: number) {
  const [x, , z] = spot.normal;
  const direction = Math.abs(x) > Math.abs(z)
    ? x > 0 ? "Right side" : "Left side"
    : z > 0 ? "Front" : "Rear";
  return `${direction} ${index + 1}`;
}
