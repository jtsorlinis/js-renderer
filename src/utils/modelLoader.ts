import type { Material } from "../materials/Material";
import { loadGlbAsset } from "./glbLoader";
import { type Mesh } from "./mesh";

const assetPath = (fileName: string) => `${import.meta.env.BASE_URL}models/${fileName}`;

const modelAssets: Record<string, ModelAssetSource> = {
  dice: {
    glbUrl: assetPath("d20.glb"),
    scale: 0.9,
  },
  can: {
    glbUrl: assetPath("can.glb"),
    scale: 0.95,
  },
  hydrant: {
    glbUrl: assetPath("hydrant.glb"),
    scale: 1.15,
  },
  head: {
    glbUrl: assetPath("head.glb"),
    scale: 1.1,
  },
  dragon: {
    glbUrl: assetPath("dragon.glb"),
    scale: 1.4,
  },
  demon: {
    glbUrl: assetPath("warrior.glb"),
    scale: 1.3,
  },
  // Secret nyxy model
  nyxy: {
    glbUrl: assetPath("nyxy.glb"),
    scale: 1.2,
  },
};

const MODEL_KEYS = Object.keys(modelAssets) as (keyof typeof modelAssets)[];

export type ModelKey = keyof typeof modelAssets;

export type ModelOption = {
  mesh: Mesh;
  material: Material;
};

type ModelAssetSource = {
  glbUrl: string;
  scale: number;
  request?: Promise<ModelOption>;
};

const prefetchAsset = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to prefetch asset: ${url} (${response.status} ${response.statusText})`);
  }
  await response.blob();
};

// Loads each model once; later calls get the same promise, or try again if it failed
export const ensureModelOption = (modelKey: ModelKey) => {
  const modelAsset = modelAssets[modelKey];
  modelAsset.request ??= loadGlbAsset(modelAsset.glbUrl, modelAsset.scale).catch((error) => {
    modelAsset.request = undefined;
    throw error;
  });
  return modelAsset.request;
};

export const loadCustomGlb = async (file: File) => {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await loadGlbAsset(objectUrl);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const prefetchRemainingModels = async (initialModelKey: ModelKey) => {
  await Promise.all(
    MODEL_KEYS.filter((modelKey) => modelKey !== initialModelKey).map(async (modelKey) => {
      try {
        await prefetchAsset(modelAssets[modelKey].glbUrl);
      } catch (error) {
        console.error(`Failed to prefetch model "${modelKey}"`, error);
      }
    }),
  );
};
