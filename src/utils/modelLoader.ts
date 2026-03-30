import { Texture } from "../drawing";
import { type LoadedModel, loadObj } from "./objLoader";

const isDogNyxy = true;

export const MODEL_KEYS = [
  "dice",
  "rock",
  "dog",
  "head",
  "dragon",
  "spartan",
] as const;

export type ModelKey = (typeof MODEL_KEYS)[number];

export type ModelOption = {
  mesh: LoadedModel;
  texture: Texture;
  normalTexture: Texture;
};

type ModelAssetSource = {
  meshUrl: string;
  textureUrl: string;
  normalTextureUrl: string;
  normalize: boolean;
  scale?: number;
  loaded?: ModelOption;
  pending?: Promise<ModelOption>;
  prefetched?: Promise<void>;
};

const assetPath = (fileName: string) =>
  `${import.meta.env.BASE_URL}models/${fileName}`;

const loadObjAsset = async (url: string, normalize = false, scale = 1) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load OBJ asset: ${url} (${response.status} ${response.statusText})`,
    );
  }
  return loadObj(await response.text(), normalize, scale);
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

const modelAssets: Record<ModelKey, ModelAssetSource> = {
  dice: {
    meshUrl: assetPath("dice.obj"),
    textureUrl: assetPath("dice_diffuse.png"),
    normalTextureUrl: assetPath("dice_normal.png"),
    normalize: true,
    scale: 0.75,
  },
  rock: {
    meshUrl: assetPath("rock.obj"),
    textureUrl: assetPath("rock_diffuse.png"),
    normalTextureUrl: assetPath("rock_normal.png"),
    normalize: true,
  },
  dog: {
    meshUrl: assetPath(`${isDogNyxy ? "nyxy" : "dog"}.obj`),
    textureUrl: assetPath(`${isDogNyxy ? "nyxy" : "dog"}_diffuse.png`),
    normalTextureUrl: assetPath(`${isDogNyxy ? "nyxy" : "dog"}_normal.png`),
    normalize: true,
    scale: 1.1,
  },
  head: {
    meshUrl: assetPath("head.obj"),
    textureUrl: assetPath("head_diffuse.png"),
    normalTextureUrl: assetPath("head_normal.png"),
    normalize: true,
  },
  dragon: {
    meshUrl: assetPath("dragon.obj"),
    textureUrl: assetPath("dragon_diffuse.png"),
    normalTextureUrl: assetPath("dragon_normal.png"),
    normalize: true,
    scale: 1.3,
  },
  spartan: {
    meshUrl: assetPath("spartan.obj"),
    textureUrl: assetPath("spartan_diffuse.png"),
    normalTextureUrl: assetPath("spartan_normal.png"),
    normalize: true,
  },
};

const prefetchModelAssets = (modelKey: ModelKey) => {
  const modelAsset = modelAssets[modelKey];
  modelAsset.prefetched ??= Promise.all([
    prefetchAsset(modelAsset.meshUrl),
    prefetchAsset(modelAsset.textureUrl),
    prefetchAsset(modelAsset.normalTextureUrl),
  ]).then(() => undefined);

  return modelAsset.prefetched;
};

export const ensureModelOption = (modelKey: ModelKey) => {
  const modelAsset = modelAssets[modelKey];
  if (modelAsset.loaded) {
    return Promise.resolve(modelAsset.loaded);
  }

  modelAsset.pending ??= Promise.all([
    loadObjAsset(modelAsset.meshUrl, modelAsset.normalize, modelAsset.scale),
    Texture.Load(modelAsset.textureUrl),
    Texture.Load(modelAsset.normalTextureUrl, true),
  ]).then(([mesh, texture, normalTexture]) => {
    const loadedModel = { mesh, texture, normalTexture };
    modelAsset.loaded = loadedModel;
    return loadedModel;
  });

  return modelAsset.pending;
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
