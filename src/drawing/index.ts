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

export const clear = (image: ImageData) => {
  image.data.fill(0);
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = 255;
  }
};

export const line = (
  start: Vector2,
  end: Vector2,
  colour: Colour,
  image: ImageData
) => {
  let s = start.clone();
  let e = end.clone();
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

const barycentric = (p1: Vector2, p2: Vector2, p3: Vector2, P: Vector2) => {
  const v1 = new Vector3(p3.x - p1.x, p2.x - p1.x, p1.x - P.x);
  const v2 = new Vector3(p3.y - p1.y, p2.y - p1.y, p1.y - P.y);
  const u = v1.cross(v2);

  // Check for degenerate triangle
  if (Math.abs(u.z) < 1) return new Vector3(-1, 1, 1);

  return new Vector3(1 - (u.x + u.y) / u.z, u.y / u.z, u.x / u.z);
};

export const triangle = (
  p0: Vector2,
  p1: Vector2,
  p2: Vector2,
  colour: Colour,
  image: ImageData
) => {
  let minX = Math.min(p0.x, p1.x, p2.x);
  let minY = Math.min(p0.y, p1.y, p2.y);
  let maxX = Math.max(p0.x, p1.x, p2.x);
  let maxY = Math.max(p0.y, p1.y, p2.y);
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const bcScreen = barycentric(p0, p1, p2, new Vector2(x, y));
      if (bcScreen.x < 0 || bcScreen.y < 0 || bcScreen.z < 0) continue;
      setPixel(new Vector2(x, y), colour, image);
    }
  }
};
