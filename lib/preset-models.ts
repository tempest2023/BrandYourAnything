export const PRESET_MODEL_IDS = [
  "tesla-model-3",
  "tesla-cybertruck",
  "flybridge-yacht",
  "private-jet",
] as const;

export type PresetModelId = (typeof PRESET_MODEL_IDS)[number];

export type PresetModel = {
  id: PresetModelId;
  assetName: string;
  fileName: string;
  publicPath: string;
  author: string;
  sourceUrl: string;
  licenseName: string;
  licenseUrl: string;
};

export const PRESET_MODELS: Record<PresetModelId, PresetModel> = {
  "tesla-model-3": {
    id: "tesla-model-3",
    assetName: "Tesla Model 3",
    fileName: "tesla-model-3.glb",
    publicPath: "/models/presets/tesla-model-3.glb",
    author: "ChoochooLi",
    sourceUrl: "https://sketchfab.com/3d-models/tesla-model-3-realistic-graphics",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  "tesla-cybertruck": {
    id: "tesla-cybertruck",
    assetName: "Tesla Cybertruck",
    fileName: "tesla-cybertruck.glb",
    publicPath: "/models/presets/tesla-cybertruck.glb",
    author: "Mobolaji",
    sourceUrl: "https://poly.pizza/m/Jpar3f32mt",
    licenseName: "CC BY 3.0",
    licenseUrl: "https://creativecommons.org/licenses/by/3.0/",
  },
  "flybridge-yacht": {
    id: "flybridge-yacht",
    assetName: "Flybridge motor yacht",
    fileName: "flybridge-yacht.glb",
    publicPath: "/models/presets/flybridge-yacht.glb",
    author: "angelo raffaele catalano",
    sourceUrl: "https://sketchfab.com/3d-models/motoryacht-35-0bdd7a0de7254426890bb5745bb7da6d",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
  "private-jet": {
    id: "private-jet",
    assetName: "Long-range private jet",
    fileName: "private-jet.glb",
    publicPath: "/models/presets/private-jet.glb",
    author: "Nick the Name",
    sourceUrl: "https://sketchfab.com/3d-models/private-jet-cbdd1de6ced9461e950eafaa302cc82b",
    licenseName: "CC BY 4.0",
    licenseUrl: "https://creativecommons.org/licenses/by/4.0/",
  },
};

const PRESET_STORAGE_PREFIX = "preset:";

export function isPresetModelId(value: unknown): value is PresetModelId {
  return typeof value === "string" && PRESET_MODEL_IDS.includes(value as PresetModelId);
}

export function getPresetModel(value: unknown) {
  return isPresetModelId(value) ? PRESET_MODELS[value] : null;
}

export function getPresetModelStoragePath(id: PresetModelId) {
  return `${PRESET_STORAGE_PREFIX}${id}`;
}

export function getPresetModelFromStoragePath(path: string | null | undefined) {
  if (!path?.startsWith(PRESET_STORAGE_PREFIX)) return null;
  return getPresetModel(path.slice(PRESET_STORAGE_PREFIX.length));
}

export function getPresetModelFromPublicPath(path: string | null | undefined) {
  if (!path) return null;
  return Object.values(PRESET_MODELS).find((model) => model.publicPath === path) ?? null;
}
