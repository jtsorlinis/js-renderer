import { setHighResTextureLimit, Texture } from "../drawing";
import { Vector3 } from "../maths";
import { loadGlbAsset } from "./glbLoader";
import { type LoadedModel } from "./mesh";

const assetPath = (fileName: string) =>
  `${import.meta.env.BASE_URL}models/${fileName}`;

const modelAssets: Record<string, ModelAssetSource> = {
  dice: {
    glbUrl: assetPath("d20.glb"),
    scale: 0.8,
  },
  rock: {
    glbUrl: assetPath("rock.glb"),
    scale: 0.9,
  },
  hydrant: {
    glbUrl: assetPath("hydrant.glb"),
  },
  treasure: {
    glbUrl: assetPath("treasure.glb"),
    scale: 1.1,
  },
  head: {
    glbUrl: assetPath("head.glb"),
  },
  dragon: {
    glbUrl: assetPath("dragon.glb"),
    scale: 1.3,
  },
  spartan: {
    glbUrl: assetPath("spartan.glb"),
    scale: 1.25,
  },
  // Secret nyxy model
  nyxy: {
    glbUrl: assetPath("nyxy.glb"),
  },
};

export const MODEL_KEYS = Object.keys(
  modelAssets,
) as (keyof typeof modelAssets)[];

export type ModelKey = keyof typeof modelAssets;

export type PbrMaterial = {
  metallicRoughnessTexture: Texture;
  baseColorFactor: Vector3;
  metallicFactor: number;
  roughnessFactor: number;
};

export type ModelOption = {
  mesh: LoadedModel;
  texture: Texture;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
};

type ModelAssetSource = {
  glbUrl: string;
  normalize?: boolean;
  scale?: number;
  loaded?: ModelOption;
  pending?: Promise<ModelOption>;
  prefetched?: Promise<void>;
};

const prefetchAsset = async (url: string) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to prefetch asset: ${url} (${response.status} ${response.statusText})`,
    );
  }
  await response.blob();
};

let highResTextureLimitsEnabled = false;

const clearLoadedModels = () => {
  for (const modelAsset of Object.values(modelAssets)) {
    delete modelAsset.loaded;
    delete modelAsset.pending;
  }
};

export const setHighResTextureLimits = (enabled: boolean) => {
  if (enabled === highResTextureLimitsEnabled) {
    return false;
  }

  highResTextureLimitsEnabled = enabled;
  setHighResTextureLimit(enabled);
  clearLoadedModels();
  return true;
};

const prefetchModelAssets = (modelKey: ModelKey) => {
  const modelAsset = modelAssets[modelKey];
  modelAsset.prefetched ??= (async () => {
    await prefetchAsset(modelAsset.glbUrl);
  })();

  return modelAsset.prefetched;
};

export const ensureModelOption = (modelKey: ModelKey) => {
  const modelAsset = modelAssets[modelKey];
  if (modelAsset.loaded) {
    return Promise.resolve(modelAsset.loaded);
  }

  modelAsset.pending ??= (async () => {
    const loadedModel = await loadGlbAsset(
      modelAsset.glbUrl,
      modelAsset.normalize,
      modelAsset.scale,
    );

    modelAsset.loaded = loadedModel;
    return loadedModel;
  })();

  return modelAsset.pending;
};

export const loadCustomGlb = async (
  file: File,
  normalize = true,
  scale = 1,
) => {
  const objectUrl = URL.createObjectURL(file);

  try {
    return await loadGlbAsset(objectUrl, normalize, scale);
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
};

export const prefetchRemainingModels = async (initialModelKey: ModelKey) => {
  for (const modelKey of MODEL_KEYS) {
    if (modelKey === initialModelKey) continue;
    try {
      await prefetchModelAssets(modelKey);
    } catch (error) {
      console.error(`Failed to prefetch model "${modelKey}"`, error);
    }
  }
};
