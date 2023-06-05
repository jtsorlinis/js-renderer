import { Vector2, Vector3 } from "../maths";
import { Colour } from "./Colour";
export { Colour };

export const setPixel = (pos: Vector2, colour: Colour, image: ImageData) => {
  const index = (pos.x + pos.y * image.width) * 4;
  image.data[index + 0] = colour.r;
  image.data[index + 1] = colour.g;
  image.data[index + 2] = colour.b;
  image.data[index + 3] = 255;
};

export const clear = (image: ImageData, zBuffer: Float32Array) => {
  image.data.fill(0);
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = 255;
  }
  zBuffer.fill(10000);
};

export const line = (
  start: Vector2,
  end: Vector2,
  colour: Colour,
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
    setPixel(s, colour, image);

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
  const v1 = new Vector3(p3.x - p1.x, p2.x - p1.x, p1.x - P.x);
  const v2 = new Vector3(p3.y - p1.y, p2.y - p1.y, p1.y - P.y);
  const u = v1.cross(v2);

  // Check for degenerate triangle
  if (Math.abs(u.z) < 0.01) return new Vector3(-1, 1, 1);

  return new Vector3(1 - (u.x + u.y) / u.z, u.y / u.z, u.x / u.z);
};

export const triangle = (
  p0: Vector3,
  p1: Vector3,
  p2: Vector3,
  zBuffer: Float32Array,
  colour: Colour,
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
      P.z = 0;
      P.z += p0.z * bcScreen.x;
      P.z += p1.z * bcScreen.y;
      P.z += p2.z * bcScreen.z;
      const index = P.x + P.y * image.width;
      if (P.z < zBuffer[index]) {
        zBuffer[index] = P.z;
        setPixel(P.xy(), colour, image);
      }
    }
  }
};
