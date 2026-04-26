import { Texture } from "../drawing";

export type Material = {
  colorTexture: Texture;
  normalTexture: Texture;
  ormTexture: Texture;
  metallicFactor: number;
  occlusionStrength: number;
  roughnessFactor: number;
};

export const defaultMaterial: Material = {
  colorTexture: Texture.White,
  normalTexture: Texture.Normal,
  ormTexture: Texture.White,
  metallicFactor: 0,
  occlusionStrength: 1,
  roughnessFactor: 0.5,
};
