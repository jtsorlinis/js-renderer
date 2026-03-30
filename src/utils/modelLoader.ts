import { Texture } from "../drawing";
import { type LoadedModel, loadObj } from "./objLoader";

import diceModelFile from "../models/dice.obj?url";
import diceDiffuseTex from "../models/dice_diffuse.png";
import diceNormalTex from "../models/dice_normal.png";
import rockModelFile from "../models/rock.obj?url";
import rockDiffuseTex from "../models/rock_diffuse.png";
import rockNormalTex from "../models/rock_normal.png";
import dogModelFile from "../models/dog.obj?url";
import dogDiffuseTex from "../models/dog_diffuse.png";
import dogNormalTex from "../models/dog_normal.png";
import headModelFile from "../models/head.obj?url";
import headDiffuseTex from "../models/head_diffuse.png";
import headNormalTex from "../models/head_normal.png";
import dragonModelFile from "../models/dragon.obj?url";
import dragonDiffuseTex from "../models/dragon_diffuse.png";
import dragonNormalTex from "../models/dragon_normal.png";
import spartanModelFile from "../models/spartan.obj?url";
import spartanDiffuseTex from "../models/spartan_diffuse.png";
import spartanNormalTex from "../models/spartan_normal.png";

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
    meshUrl: diceModelFile,
    textureUrl: diceDiffuseTex,
    normalTextureUrl: diceNormalTex,
    normalize: true,
    scale: 0.75,
  },
  rock: {
    meshUrl: rockModelFile,
    textureUrl: rockDiffuseTex,
    normalTextureUrl: rockNormalTex,
    normalize: true,
  },
  dog: {
    meshUrl: dogModelFile,
    textureUrl: dogDiffuseTex,
    normalTextureUrl: dogNormalTex,
    normalize: true,
    scale: 1.1,
  },
  head: {
    meshUrl: headModelFile,
    textureUrl: headDiffuseTex,
    normalTextureUrl: headNormalTex,
    normalize: true,
  },
  dragon: {
    meshUrl: dragonModelFile,
    textureUrl: dragonDiffuseTex,
    normalTextureUrl: dragonNormalTex,
    normalize: true,
    scale: 1.3,
  },
  spartan: {
    meshUrl: spartanModelFile,
    textureUrl: spartanDiffuseTex,
    normalTextureUrl: spartanNormalTex,
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
