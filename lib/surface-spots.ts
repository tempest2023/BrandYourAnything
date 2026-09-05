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
  size: SurfaceSpotSize;
  dimensions: string;
  openingBidCents: number;
  position?: SurfaceVector;
  normal?: SurfaceVector;
};

export type SurfacePlacementProfile = "car" | "yacht" | "jet" | "generic";
export type SurfaceSpotSize = "S" | "M" | "L";

export type SurfacePlacementType = {
  size: SurfaceSpotSize;
  label: string;
  coverage: string;
};

export const SURFACE_PLACEMENT_TYPES: SurfacePlacementType[] = [
  {
    size: "L",
    label: "Large panel",
    coverage: "Up to 60% of the selected region",
  },
  {
    size: "M",
    label: "Medium panel",
    coverage: "Up to 35% of the selected region",
  },
  {
    size: "S",
    label: "Logo mark",
    coverage: "Up to 15% of the selected region",
  },
];

export const SURFACE_REGIONS_BY_PROFILE: Record<SurfacePlacementProfile, string[]> = {
  car: [
    "Hood",
    "Driver front door",
    "Passenger front door",
    "Driver rear door",
    "Passenger rear door",
    "Driver front quarter panel",
    "Passenger front quarter panel",
    "Driver rear quarter panel",
    "Passenger rear quarter panel",
    "Roof",
    "Tailgate / boot",
    "Front bumper",
    "Rear bumper",
    "Other exterior surface",
  ],
  yacht: [
    "Port hull",
    "Starboard hull",
    "Port superstructure",
    "Starboard superstructure",
    "Bow",
    "Stern / transom",
    "Flybridge",
    "Port equipment area",
    "Starboard equipment area",
    "Other exterior surface",
  ],
  jet: [
    "Port fuselage",
    "Starboard fuselage",
    "Port engine nacelle",
    "Starboard engine nacelle",
    "Port tail",
    "Starboard tail",
    "Nose",
    "Port winglet",
    "Starboard winglet",
    "Boarding door",
    "Other exterior surface",
  ],
  generic: [
    "Front face",
    "Rear face",
    "Left side",
    "Right side",
    "Upper surface",
    "Lower side",
    "Centre feature",
    "Outer edge",
    "Other exterior surface",
  ],
};

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

export function surfaceSpotSize(index: number, count: number): SurfaceSpotSize {
  const largeCount = Math.max(1, Math.round(count * 0.3));
  const mediumCount = Math.max(1, Math.round(count * 0.3));
  if (index < largeCount) return "L";
  if (index < largeCount + mediumCount) return "M";
  return "S";
}

export function surfaceRegionFor(profile: SurfacePlacementProfile, index: number) {
  const regions = SURFACE_REGIONS_BY_PROFILE[profile];
  return regions[index] ?? regions[regions.length - 1];
}

export function surfacePlacementType(size: SurfaceSpotSize) {
  return SURFACE_PLACEMENT_TYPES.find((option) => option.size === size)
    ?? SURFACE_PLACEMENT_TYPES[SURFACE_PLACEMENT_TYPES.length - 1];
}

export function surfaceSpotName(spot: SurfaceSpotPlacement, index: number) {
  const [x, , z] = spot.normal;
  const direction = Math.abs(x) > Math.abs(z)
    ? x > 0 ? "Right side" : "Left side"
    : z > 0 ? "Front" : "Rear";
  return `${direction} ${index + 1}`;
}
