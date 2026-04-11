import { Texture } from "../drawing";
import { Vector3 } from "../maths";

export type Material = {
  baseColorTexture: Texture;
  normalTexture: Texture;
  metallicRoughnessTexture: Texture;
  baseColorFactor: Vector3;
  metallicFactor: number;
  roughnessFactor: number;
};

export const defaultMaterial: Material = {
  baseColorTexture: Texture.White,
  normalTexture: Texture.Normal,
  metallicRoughnessTexture: Texture.White,
  baseColorFactor: Vector3.One,
  metallicFactor: 0,
  roughnessFactor: 0.5,
};
