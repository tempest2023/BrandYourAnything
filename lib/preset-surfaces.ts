import type { PresetModelId } from "./preset-models";
import type { SurfaceVector } from "./surface-spots";

// Calibrated against the bundled GLBs after ModelStage's 2.8-unit normalization.
// Cars/yacht face -Z (left/port = -X); jet faces -X (port = +Z).
// Driver labels assume the bundled left-hand-drive Tesla variants.
// These are ray targets, not floating anchors. Never infer vehicle axes from its
// longest dimension (aircraft wings and loose geometry break that assumption).
export type PresetSurface = { region: string; target: SurfaceVector; outward: SurfaceVector; distance?: number };
const side = (region: string, y: number, z: number, sign: number): PresetSurface => ({
  region, target: [0, y, z], outward: [sign, 0, 0],
});
export const PRESET_SURFACES: Record<PresetModelId, PresetSurface[]> = {
  "tesla-model-3": [
    { region: "Hood", target: [0, 0, -0.98], outward: [0, 1, 0] },
    side("Driver front door", 0.04, -0.30, -1),
    side("Passenger front door", 0.04, -0.30, 1),
    side("Driver rear door", 0.04, 0.35, -1),
    side("Passenger rear door", 0.04, 0.35, 1),
    { region: "Tailgate / boot", target: [0, 0.06, 0], outward: [0, 0, 1] },
  ],
  "tesla-cybertruck": [
    { region: "Hood", target: [0, 0, -1.14], outward: [0, 1, 0] },
    side("Driver front door", -0.07, -0.29, -1),
    side("Passenger front door", -0.07, -0.29, 1),
    side("Driver rear door", -0.07, 0.35, -1),
    side("Passenger rear door", -0.07, 0.35, 1),
    { region: "Tailgate / boot", target: [0, -0.04, 0], outward: [0, 0, 1] },
    side("Driver rear quarter panel", 0.20, 0.98, -1),
    side("Passenger rear quarter panel", 0.20, 0.98, 1),
  ],
  "flybridge-yacht": [
    side("Port hull", -0.10, -0.45, -1),
    side("Starboard hull", -0.10, -0.45, 1),
    side("Port superstructure", 0.12, 0.05, -1),
    side("Starboard superstructure", 0.12, 0.05, 1),
    { region: "Stern / transom", target: [0.2, -0.25, 1.1], outward: [0, 0, 1], distance: 0.3 },
    side("Port aft hull", -0.10, 0.45, -1),
    side("Starboard aft hull", -0.10, 0.45, 1),
  ],
  "private-jet": [
    { region: "Port fuselage", target: [-0.58, -0.11, 0], outward: [0, 0, 1] },
    { region: "Starboard fuselage", target: [-0.58, -0.11, 0], outward: [0, 0, -1] },
    { region: "Port engine nacelle", target: [0.25, -0.02, 0.30], outward: [0, 0, 1], distance: 0.28 },
    { region: "Starboard engine nacelle", target: [0.25, -0.02, -0.30], outward: [0, 0, -1], distance: 0.28 },
    { region: "Port tail", target: [1.12, 0.20, 0], outward: [0, 0, 1] },
    { region: "Starboard tail", target: [1.12, 0.20, 0], outward: [0, 0, -1] },
  ],
};
