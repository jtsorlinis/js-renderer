import { Texture } from "../drawing";
import { Vector3 } from "../maths";

export type PbrMaterial = {
  metallicRoughnessTexture: Texture;
  baseColorFactor: Vector3;
  metallicFactor: number;
  roughnessFactor: number;
};

export const defaultPbrMaterial: PbrMaterial = {
  metallicRoughnessTexture: new Texture(),
  baseColorFactor: Vector3.One,
  metallicFactor: 1,
  roughnessFactor: 1,
};
