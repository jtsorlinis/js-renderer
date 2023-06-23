import { Vector2, Vector3, Vector4 } from "./maths";

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

export const viewportTransform = (v: Vector4, imageDimensions: Vector2) => {
  const x = (v.x + 1) * (imageDimensions.x * 0.5);
  const y = (-v.y + 1) * (imageDimensions.y * 0.5);
  return new Vector4(x, y, v.z, v.w);
};

export const barycentric = (p: Vector3, a: Vector3, b: Vector3, c: Vector3) => {
  const v0x = b.x - a.x;
  const v0y = b.y - a.y;
  const v1x = c.x - a.x;
  const v1y = c.y - a.y;
  const v2x = p.x - a.x;
  const v2y = p.y - a.y;

  const denom = v0x * v1y - v1x * v0y;

  const v = (v2x * v1y - v1x * v2y) / denom;
  const w = (v0x * v2y - v2x * v0y) / denom;
  const u = 1 - v - w;

  return { u, v, w };
};
