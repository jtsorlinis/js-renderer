import { setPixel, viewportTransform } from ".";
import { Vector3 } from "../maths";
import { BaseShader } from "../shaders/BaseShader";

export interface Barycentric {
  u: number;
  v: number;
  w: number;
}

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
  verts: Vector3[],
  shader: BaseShader,
  image: ImageData,
  zBuffer: Float32Array
) => {
  // Extract vertex positions
  let p0 = verts[0];
  let p1 = verts[1];
  let p2 = verts[2];

  // Clip near and far planes
  if (p0.z < 0 || p1.z < 0 || p2.z < 0) return;
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
  const bc: Barycentric = { u: 0, v: 0, w: 0 };

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
      P.z = p0.z * bc.u + p1.z * bc.v + p2.z * bc.w;

      // Check pixel'z depth against z buffer, if pixel is closer, draw it
      const index = P.x + P.y * image.width;
      if (P.z < zBuffer[index]) {
        // Update z buffer with new pixel depth
        zBuffer[index] = P.z;

        // Fragment shader
        shader.bc = bc;
        const finalColour = shader.fragment();

        // Set final pixel colour
        if (!finalColour) continue;
        setPixel(P.xy, finalColour.toRGB(), image);
      }
    }
  }
};
