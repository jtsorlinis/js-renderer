import { Texture } from "../drawing";
import { Vector3 } from "../maths";

export type Material = {
  colorTexture: Texture;
  normalTexture: Texture;
  metallicRoughnessTexture: Texture;
  colorFactor: Vector3;
  metallicFactor: number;
  roughnessFactor: number;
};

export const defaultMaterial: Material = {
  colorTexture: Texture.White,
  normalTexture: Texture.Normal,
  metallicRoughnessTexture: Texture.White,
  colorFactor: Vector3.One,
  metallicFactor: 0,
  roughnessFactor: 0.5,
};
