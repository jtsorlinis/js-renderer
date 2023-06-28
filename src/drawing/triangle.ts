import { DepthTexture, Framebuffer } from ".";
import { Vector4 } from "../maths";
import { BaseShader } from "../shaders/BaseShader";

export interface Barycentric {
  u: number;
  v: number;
  w: number;
}

// Calculates the signed area of a triangle from 3 points
const edgeFunction = (a: Vector4, b: Vector4, c: Vector4) => {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
};

// Only instantiate these once and reuse them
const P = new Vector4();
const bc: Barycentric = { u: 0, v: 0, w: 0 };
const bcClip: Barycentric = { u: 0, v: 0, w: 0 };

// Draw a triangle in screen space (pixels)
export const triangle = (
  verts: Vector4[],
  shader: BaseShader,
  buffer: Framebuffer,
  zBuffer: DepthTexture
) => {
  // Extract vertex positions
  let v0 = verts[0];
  let v1 = verts[1];
  let v2 = verts[2];

  // Clip near and far planes
  if (v0.z < 0 || v1.z < 0 || v2.z < 0) return;
  if (v0.z > 1 || v1.z > 1 || v2.z > 1) return;

  // Clip triangles that are fully outside the viewport
  if (v0.x < -1 && v1.x < -1 && v2.x < -1) return;
  if (v0.x > 1 && v1.x > 1 && v2.x > 1) return;
  if (v0.y < -1 && v1.y < -1 && v2.y < -1) return;
  if (v0.y > 1 && v1.y > 1 && v2.y > 1) return;

  // Backface culling based on winding order
  const area = edgeFunction(v0, v1, v2);
  if (area <= 0) return;

  // Scale from [-1, 1] to [0, width] and [0, height]]
  const p0 = buffer.viewportTransform(v0);
  const p1 = buffer.viewportTransform(v1);
  const p2 = buffer.viewportTransform(v2);

  // Calculate inverse signed area of triangle in screen space
  const invAreaSs = 1 / edgeFunction(p2, p1, p0);

  // Calculate bounding box
  let minX = ~~Math.max(0, Math.min(p0.x, p1.x, p2.x));
  let minY = ~~Math.max(0, Math.min(p0.y, p1.y, p2.y));
  let maxX = ~~Math.min(buffer.width, Math.max(p0.x, p1.x, p2.x));
  let maxY = ~~Math.min(buffer.height, Math.max(p0.y, p1.y, p2.y));

  // Loop over pixels in bounding box
  for (P.y = minY; P.y <= maxY; P.y++) {
    for (P.x = minX; P.x <= maxX; P.x++) {
      // Check if pixel is inside triangle using edge functions
      const w0 = edgeFunction(p2, p1, P);
      const w1 = edgeFunction(p0, p2, P);
      const w2 = edgeFunction(p1, p0, P);

      // Skip pixel if outside triangle
      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      // Calculate barycentric coordinates of point using edge functions
      bc.u = w0 * invAreaSs;
      bc.v = w1 * invAreaSs;
      bc.w = 1 - bc.u - bc.v;

      // Interpolate depth to get z value at pixel
      P.z = p0.z * bc.u + p1.z * bc.v + p2.z * bc.w;

      // Check pixel'z depth against z buffer, if pixel is closer, draw it
      const index = P.x + P.y * buffer.width;
      if (P.z < zBuffer.data[index]) {
        // Update z buffer with new depth
        zBuffer.data[index] = P.z;

        // Get perspective correct barycentric coordinates
        P.w = 1 / (p0.w * bc.u + p1.w * bc.v + p2.w * bc.w);
        bcClip.u = bc.u * P.w * p0.w;
        bcClip.v = bc.v * P.w * p1.w;
        bcClip.w = 1 - bcClip.u - bcClip.v;

        // Fragment shader
        shader.bc = bcClip;
        shader.fragPos = P;
        const frag = shader.fragment();

        // If pixel is discarded, skip it
        if (!frag) continue;

        // Set final pixel colour
        buffer.setPixel(P.x, P.y, frag);
      }
    }
  }
};
