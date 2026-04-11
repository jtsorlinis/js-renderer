import { Texture } from "../drawing";
import { Vector3 } from "../maths";

export type PbrMaterial = {
  metallicRoughnessTexture: Texture;
  baseColorFactor: Vector3;
  metallicFactor: number;
  roughnessFactor: number;
};

export const defaultPbrMaterial: PbrMaterial = {
  metallicRoughnessTexture: Texture.White,
  baseColorFactor: Vector3.One,
  metallicFactor: 0,
  roughnessFactor: 0.5,
};
