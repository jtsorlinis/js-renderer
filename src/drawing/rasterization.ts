import { setPixel, viewportTransform } from ".";
import { Vector3 } from "../maths";

const WHITE = new Vector3(255, 255, 255);

export const line = (start: Vector3, end: Vector3, image: ImageData) => {
  // Clip near and far planes
  if (start.z < -1 || end.z < -1) return;
  if (start.z > 1 || end.z > 1) return;

  // Viewport transform
  start = viewportTransform(start, image);
  end = viewportTransform(end, image);

  // Don't draw if line is completely off screen
  if (start.x < 0 && end.x < 0) return;
  if (start.y < 0 && end.y < 0) return;
  if (start.x > image.width && end.x > image.width) return;
  if (start.y > image.height && end.y > image.height) return;

  // Round to nearest pixel
  let s = start.truncate();
  let e = end.truncate();

  const dx = Math.abs(e.x - s.x);
  const dy = Math.abs(e.y - s.y);
  const sx = s.x < e.x ? 1 : -1;
  const sy = s.y < e.y ? 1 : -1;
  let err = dx - dy;

  while (true) {
    if (s.x >= 0 && s.x < image.width && s.y >= 0 && s.y < image.height) {
      setPixel(s.xy, WHITE, image);
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
  const v0x = p2.x - p1.x;
  const v0y = p2.y - p1.y;
  const v1x = p3.x - p1.x;
  const v1y = p3.y - p1.y;
  const v2x = P.x - p1.x;
  const v2y = P.y - p1.y;

  const invDenom = 1 / (v0x * v1y - v1x * v0y);
  const v = (v2x * v1y - v1x * v2y) * invDenom;
  const w = (v0x * v2y - v2x * v0y) * invDenom;
  const u = 1 - v - w;

  return { u, v, w };
};

export const triangle = (
  verts: any,
  zBuffer: Float32Array,
  image: ImageData
) => {
  let p0 = verts[0].position;
  let p1 = verts[1].position;
  let p2 = verts[2].position;
  const c0 = verts[0].colour;
  const c1 = verts[1].colour;
  const c2 = verts[2].colour;

  // Clip near and far planes
  if (p0.z < -1 || p1.z < -1 || p2.z < -1) return;
  if (p0.z > 1 || p1.z > 1 || p2.z > 1) return;

  // Backface culling
  const ab = p2.subtract(p0);
  const ac = p1.subtract(p0);
  const n = ab.x * ac.y - ac.x * ab.y;
  if (n < 0) return;

  // Viewport transform
  p0 = viewportTransform(p0, image);
  p1 = viewportTransform(p1, image);
  p2 = viewportTransform(p2, image);

  let minX = ~~Math.max(0, Math.min(p0.x, p1.x, p2.x));
  let minY = ~~Math.max(0, Math.min(p0.y, p1.y, p2.y));
  let maxX = ~~Math.min(image.width, Math.max(p0.x, p1.x, p2.x));
  let maxY = ~~Math.min(image.height, Math.max(p0.y, p1.y, p2.y));
  const P = new Vector3();
  const c = new Vector3();
  for (P.y = minY; P.y <= maxY; P.y++) {
    for (P.x = minX; P.x <= maxX; P.x++) {
      const bc = barycentric(p0, p1, p2, P);
      if (bc.u < 0 || bc.v < 0 || bc.w < 0) continue;
      P.z = p0.z * bc.u + p1.z * bc.v + p2.z * bc.w;
      const index = P.x + P.y * image.width;
      if (P.z < zBuffer[index]) {
        zBuffer[index] = P.z;
        // Interpolate colour
        c.x = c0.x * bc.u + c1.x * bc.v + c2.x * bc.w;
        c.y = c0.y * bc.u + c1.y * bc.v + c2.y * bc.w;
        c.z = c0.z * bc.u + c1.z * bc.v + c2.z * bc.w;
        setPixel(P.xy, c, image);
      }
    }
  }
};
