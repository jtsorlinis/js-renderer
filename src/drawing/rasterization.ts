import { Barycentric, Vertex, setPixel, viewportTransform } from ".";
import { Vector3 } from "../maths";

const WHITE = new Vector3(255, 255, 255);

// Bresenham's line algorithm
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

// Calculate barycentric coordinates for a point P in triangle (p1, p2, p3)
// We only calculaate 2D coordinates because the triangle is already in screen space
const barycentric = (
  p1: Vector3,
  p2: Vector3,
  p3: Vector3,
  P: Vector3,
  out: Barycentric
) => {
  const v0x = p2.x - p1.x;
  const v0y = p2.y - p1.y;
  const v1x = p3.x - p1.x;
  const v1y = p3.y - p1.y;
  const v2x = P.x - p1.x;
  const v2y = P.y - p1.y;

  const invDenom = 1 / (v0x * v1y - v1x * v0y);
  out.v = (v2x * v1y - v1x * v2y) * invDenom;
  out.w = (v0x * v2y - v2x * v0y) * invDenom;
  out.u = 1 - out.v - out.w;
};

// Draw a triangle in screen space (pixels)
export const triangle = (
  verts: Vertex[],
  zBuffer: Float32Array,
  image: ImageData
) => {
  // Extract vertex positions
  let p0 = verts[0].position;
  let p1 = verts[1].position;
  let p2 = verts[2].position;

  // Clip near and far planes
  if (p0.z < -1 || p1.z < -1 || p2.z < -1) return;
  if (p0.z > 1 || p1.z > 1 || p2.z > 1) return;

  // Backface culling based on winding order
  const ab = p2.subtract(p0);
  const ac = p1.subtract(p0);
  const determinant = ab.x * ac.y - ac.x * ab.y;
  if (determinant < 0) return;

  // Viewport transform
  p0 = viewportTransform(p0, image);
  p1 = viewportTransform(p1, image);
  p2 = viewportTransform(p2, image);

  // Reuse variables to avoid allocations
  const P = new Vector3();
  const c = new Vector3();
  const n = new Vector3();
  const bc: Barycentric = { u: 0, v: 0, w: 0 };

  // Extract attributes
  const c0 = verts[0].colour;
  const c1 = verts[1].colour;
  const c2 = verts[2].colour;

  const n0 = verts[0].normal;
  const n1 = verts[1].normal;
  const n2 = verts[2].normal;

  // Calculate bounding box
  let minX = ~~Math.max(0, Math.min(p0.x, p1.x, p2.x));
  let minY = ~~Math.max(0, Math.min(p0.y, p1.y, p2.y));
  let maxX = ~~Math.min(image.width, Math.max(p0.x, p1.x, p2.x));
  let maxY = ~~Math.min(image.height, Math.max(p0.y, p1.y, p2.y));

  // Loop over pixels in bounding box
  for (P.y = minY; P.y <= maxY; P.y++) {
    for (P.x = minX; P.x <= maxX; P.x++) {
      // Calculate barycentric coordinates of pixel in triangle
      barycentric(p0, p1, p2, P, bc);

      // Skip pixel if outside triangle
      if (bc.u < 0 || bc.v < 0 || bc.w < 0) continue;

      // Interpolate depth to get z value at pixel
      P.z = interpolate(p0.z, p1.z, p2.z, bc);

      // Check pixel'z depth against z buffer, if pixel is closer, draw it
      const index = P.x + P.y * image.width;
      if (P.z < zBuffer[index]) {
        // Update z buffer with new pixel depth
        zBuffer[index] = P.z;

        // Interpolate attributes
        interpolateVec3(c0, c1, c2, bc, c);
        interpolateVec3(n0, n1, n2, bc, n);

        // Set final pixel colour
        setPixel(P.xy, c, image);
      }
    }
  }
};

// Interpolate a value given barycentric coordinates
const interpolate = (n0: number, n1: number, n2: number, bc: Barycentric) => {
  return n0 * bc.u + n1 * bc.v + n2 * bc.w;
};

// Interpolate a vector given barycentric coordinates
const interpolateVec3 = (
  v0: Vector3,
  v1: Vector3,
  v2: Vector3,
  bc: Barycentric,
  out: Vector3
) => {
  out.x = interpolate(v0.x, v1.x, v2.x, bc);
  out.y = interpolate(v0.y, v1.y, v2.y, bc);
  out.z = interpolate(v0.z, v1.z, v2.z, bc);
};
