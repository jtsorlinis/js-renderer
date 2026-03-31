import { setHighResTextureLimit, Texture } from "../drawing";
import { loadGlbAsset } from "./glbLoader";
import { type LoadedModel, loadObjAsset } from "./objLoader";

const isDogNyxy = true;

const assetPath = (fileName: string) =>
  `${import.meta.env.BASE_URL}models/${fileName}`;

const modelAssets: Record<string, ModelAssetSource> = {
  dice: {
    meshUrl: assetPath("dice.obj"),
    textureUrl: assetPath("dice_diffuse.png"),
    normalTextureUrl: assetPath("dice_normal.png"),
    scale: 0.75,
  },
  rock: {
    meshUrl: assetPath("rock.obj"),
    textureUrl: assetPath("rock_diffuse.png"),
    normalTextureUrl: assetPath("rock_normal.png"),
  },
  dog: {
    meshUrl: assetPath(isDogNyxy ? "nyxy.glb" : "dog.glb"),
  },
  head: {
    meshUrl: assetPath("head.glb"),
  },
  dragon: {
    meshUrl: assetPath("dragon.glb"),
    scale: 1.3,
  },
  spartan: {
    meshUrl: assetPath("spartan.glb"),
  },
};

export const MODEL_KEYS = Object.keys(
  modelAssets,
) as (keyof typeof modelAssets)[];

export type ModelKey = keyof typeof modelAssets;

export type ModelOption = {
  mesh: LoadedModel;
  texture: Texture;
  normalTexture: Texture;
};

type ModelAssetSource = {
  meshUrl: string;
  textureUrl?: string;
  normalTextureUrl?: string;
  normalize?: boolean;
  scale?: number;
  loaded?: ModelOption;
  pending?: Promise<ModelOption>;
  prefetched?: Promise<void>;
};

const isGlbAsset = (url: string) => {
  return url.split("?")[0].toLowerCase().endsWith(".glb");
};

const requireAssetUrl = (url: string | undefined, assetType: string) => {
  if (!url) {
    throw new Error(`Missing ${assetType} URL for model asset`);
  }
  return url;
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
    if (isGlbAsset(modelAsset.meshUrl)) {
      await prefetchAsset(modelAsset.meshUrl);
      return;
    }

    await Promise.all([
      prefetchAsset(modelAsset.meshUrl),
      prefetchAsset(requireAssetUrl(modelAsset.textureUrl, "texture")),
      prefetchAsset(
        requireAssetUrl(modelAsset.normalTextureUrl, "normal texture"),
      ),
    ]);
  })();

  return modelAsset.prefetched;
};

export const ensureModelOption = (modelKey: ModelKey) => {
  const modelAsset = modelAssets[modelKey];
  if (modelAsset.loaded) {
    return Promise.resolve(modelAsset.loaded);
  }

  modelAsset.pending ??= (async () => {
    const loadedModel = isGlbAsset(modelAsset.meshUrl)
      ? await loadGlbAsset(
          modelAsset.meshUrl,
          modelAsset.normalize,
          modelAsset.scale,
        )
      : await (async () => {
          const [mesh, texture, normalTexture] = await Promise.all([
            loadObjAsset(
              modelAsset.meshUrl,
              modelAsset.normalize,
              modelAsset.scale,
            ),
            Texture.Load(requireAssetUrl(modelAsset.textureUrl, "texture")),
            Texture.Load(
              requireAssetUrl(modelAsset.normalTextureUrl, "normal texture"),
              true,
            ),
          ]);

          return { mesh, texture, normalTexture };
        })();

    modelAsset.loaded = loadedModel;
    return loadedModel;
  })();

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
