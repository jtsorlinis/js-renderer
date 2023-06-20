import { Vector2, Vector3, Vector4 } from "../maths";
import { DepthTexture } from "./Texture";

export const setPixel = (
  x: number,
  y: number,
  imageDim: Vector2,
  colour: Vector3,
  buffer: Uint8ClampedArray
) => {
  const index = (x + y * imageDim.x) * 4;
  buffer[index + 0] = colour.x * 255;
  buffer[index + 1] = colour.y * 255;
  buffer[index + 2] = colour.z * 255;
};

export const clear = (buffer: Uint8ClampedArray) => {
  buffer.fill(0);
  for (let i = 3; i < buffer.length; i += 4) {
    buffer[i] = 255;
  }
};

export const clearDepthTexture = (texture: DepthTexture, val: number) => {
  texture.data.fill(val);
};

export const viewportTransform = (v: Vector4, imageDimensions: Vector2) => {
  const x = (v.x + 1) * (imageDimensions.x * 0.5);
  const y = (-v.y + 1) * (imageDimensions.y * 0.5);
  return new Vector4(x, y, v.z, v.w);
};
