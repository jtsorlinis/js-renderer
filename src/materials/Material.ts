import type { Texture } from "../drawing";

export type Material = {
  colorTexture: Texture;
  normalTexture: Texture;
  ormTexture: Texture;
  metallicFactor: number;
  occlusionStrength: number;
  roughnessFactor: number;
};
