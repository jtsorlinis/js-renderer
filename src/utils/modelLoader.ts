import type { Material } from "../materials/Material";
import { loadGlbAsset } from "./glbLoader";
import { type Mesh } from "./mesh";

const modelAssets = new Map<string, ModelAssetSource>();

export type ModelOption = {
  mesh: Mesh;
  material: Material;
};

type ModelAssetSource = {
  glbUrl: string;
  normalize?: boolean;
  scale?: number;
  loaded?: ModelOption;
  pending?: Promise<ModelOption>;
};

const ensureLoadedModelOption = (modelAsset: ModelAssetSource) => {
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

export const ensureModelUrlOption = (glbUrl: string, normalize = true, scale = 1) => {
  const cacheKey = `${glbUrl}|${normalize ? 1 : 0}|${scale}`;
  let modelAsset = modelAssets.get(cacheKey);
  if (!modelAsset) {
    modelAsset = { glbUrl, normalize, scale };
    modelAssets.set(cacheKey, modelAsset);
  }

  return ensureLoadedModelOption(modelAsset);
};
