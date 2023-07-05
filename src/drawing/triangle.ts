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
  // Scale from [-1, 1] to [0, width] and [0, height]]
  const p0 = buffer.viewportTransform(verts[0]);
  const p1 = buffer.viewportTransform(verts[1]);
  const p2 = buffer.viewportTransform(verts[2]);

  // Calculate inverse signed area of triangle
  const invArea = 1 / edgeFunction(p2, p1, p0);

  // Backface culling based on winding order
  if (invArea <= 0) return;

  // // Clip near and far planes
  if (p0.z < 0 || p1.z < 0 || p2.z < 0) return;
  if (p0.z > 1 || p1.z > 1 || p2.z > 1) return;

  // Clip triangles that are fully outside the viewport
  if (
    (p0.x < 0 && p1.x < 0 && p2.x < 0) ||
    (p0.x > buffer.width && p1.x > buffer.width && p2.x > buffer.width) ||
    (p0.y < 0 && p1.y < 0 && p2.y < 0) ||
    (p0.y > buffer.height && p1.y > buffer.height && p2.y > buffer.height)
  )
    return;

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
      bc.u = w0 * invArea;
      bc.v = w1 * invArea;
      bc.w = w2 * invArea;

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
        bcClip.w = bc.w * P.w * p2.w;

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
