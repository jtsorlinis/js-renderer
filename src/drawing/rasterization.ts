import { setPixel } from ".";
import { Vector3 } from "../maths";

export const line = (
  start: Vector3,
  end: Vector3,
  colour: Vector3,
  image: ImageData
) => {
  let s = start.truncate();
  let e = end.truncate();

  const dx = Math.abs(e.x - s.x);
  const dy = Math.abs(e.y - s.y);
  const sx = s.x < e.x ? 1 : -1;
  const sy = s.y < e.y ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (s.x >= 0 && s.x < image.width && s.y >= 0 && s.y < image.height) {
      setPixel(s.xy, colour, image);
    }

    if (s.x === e.x && s.y === e.y) break;
    const e2 = 2 * err;
    if (e2 > -dy) {
      err -= dy;
      s.x += sx;
    }
    if (e2 < dx) {
      err += dx;
      s.y += sy;
    }
  }
};

const barycentric = (p1: Vector3, p2: Vector3, p3: Vector3, P: Vector3) => {
  const v0 = p2.subtract(p1);
  const v1 = p3.subtract(p1);
  const v2 = P.subtract(p1);

  const denom = v0.x * v1.y - v1.x * v0.y;
  const v = (v2.x * v1.y - v1.x * v2.y) / denom;
  const w = (v0.x * v2.y - v2.x * v0.y) / denom;
  const u = 1 - v - w;

  return new Vector3(u, v, w);
};

export const triangle = (
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  zBuffer: Float32Array,
  colour: Vector3,
  image: ImageData
) => {
  let minX = ~~Math.max(0, Math.min(p0.x, p1.x, p2.x));
  let minY = ~~Math.max(0, Math.min(p0.y, p1.y, p2.y));
  let maxX = ~~Math.min(image.width, Math.max(p0.x, p1.x, p2.x));
  let maxY = ~~Math.min(image.height, Math.max(p0.y, p1.y, p2.y));
  const P = new Vector3();
  for (P.y = minY; P.y <= maxY; P.y++) {
    for (P.x = minX; P.x <= maxX; P.x++) {
      const bcScreen = barycentric(p0, p1, p2, P);
      if (bcScreen.x < 0 || bcScreen.y < 0 || bcScreen.z < 0) continue;
      P.z = p0.z * bcScreen.x + p1.z * bcScreen.y + p2.z * bcScreen.z;
      const index = P.x + P.y * image.width;
      if (P.z < zBuffer[index]) {
        zBuffer[index] = P.z;
        setPixel(P.xy, colour, image);
      }
    }
  }
};
