import { Texture } from "../drawing";
import { Vector3 } from "../maths";

export type Material = {
  colorTexture: Texture;
  normalTexture: Texture;
  ormTexture: Texture;
  colorFactor: Vector3;
  metallicFactor: number;
  occlusionStrength: number;
  roughnessFactor: number;
};

export const defaultMaterial: Material = {
  colorTexture: Texture.White,
  normalTexture: Texture.Normal,
  ormTexture: Texture.White,
  colorFactor: Vector3.One,
  metallicFactor: 0,
  occlusionStrength: 1,
  roughnessFactor: 0.5,
};
