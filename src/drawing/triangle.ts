import { DepthTexture, Framebuffer } from ".";
import { Vector3, Vector4 } from "../maths";
import { BaseShader } from "../shaders/BaseShader";

export interface Barycentric {
  u: number;
  v: number;
  w: number;
}

// Calculates the signed area of a triangle from 3 points.
// Counter-clockwise winding is positive in NDC/Y-up space.
export const edgeFunction = (a: Vector4, b: Vector4, c: Vector4) => {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
};

// Only instantiate these once and reuse them
const bcClip: Barycentric = { u: 0, v: 0, w: 0 };
const fragPos = new Vector3();

// Draw a triangle in screen space (pixels)
export const triangle = (
  verts: Vector4[],
  shader: BaseShader,
  buffer: Framebuffer,
  depthBuffer: DepthTexture,
) => {
  const v0 = verts[0];
  const v1 = verts[1];
  const v2 = verts[2];

  // Scale from [-1, 1] to [0, width] and [0, height]
  const halfWidth = buffer.width * 0.5;
  const halfHeight = buffer.height * 0.5;
  const p0x = (v0.x + 1) * halfWidth;
  const p0y = (-v0.y + 1) * halfHeight;
  const p1x = (v1.x + 1) * halfWidth;
  const p1y = (-v1.y + 1) * halfHeight;
  const p2x = (v2.x + 1) * halfWidth;
  const p2y = (-v2.y + 1) * halfHeight;

  // Treat counter-clockwise triangles in NDC as front-facing.
  const area = (p2x - p0x) * (p1y - p0y) - (p2y - p0y) * (p1x - p0x);
  if (area <= 0) return;

  // Clip near and far planes [0,1]
  if (v0.z < 0 || v1.z < 0 || v2.z < 0) return;
  if (v0.z > 1 || v1.z > 1 || v2.z > 1) return;

  // Reject triangles that are fully outside the viewport
  if (
    (p0x < 0 && p1x < 0 && p2x < 0) ||
    (p0x > buffer.width && p1x > buffer.width && p2x > buffer.width) ||
    (p0y < 0 && p1y < 0 && p2y < 0) ||
    (p0y > buffer.height && p1y > buffer.height && p2y > buffer.height)
  )
    return;

  // Calculate bounding box
  const minX = ~~Math.max(0, Math.min(p0x, p1x, p2x));
  const minY = ~~Math.max(0, Math.min(p0y, p1y, p2y));
  const maxX = ~~Math.min(buffer.width - 1, Math.max(p0x, p1x, p2x));
  const maxY = ~~Math.min(buffer.height - 1, Math.max(p0y, p1y, p2y));

  // Calculate barycentric coordinates for first pixel
  const invArea = 1 / area;
  let uRow = ((minX - p1x) * (p2y - p1y) - (minY - p1y) * (p2x - p1x)) * invArea;
  let vRow = ((minX - p2x) * (p0y - p2y) - (minY - p2y) * (p0x - p2x)) * invArea;
  let wRow = ((minX - p0x) * (p1y - p0y) - (minY - p0y) * (p1x - p0x)) * invArea;

  // Calculate barycentric coordinate steps
  const uStepX = (p2y - p1y) * invArea;
  const uStepY = (p1x - p2x) * invArea;
  const vStepX = (p0y - p2y) * invArea;
  const vStepY = (p2x - p0x) * invArea;
  const wStepX = (p1y - p0y) * invArea;
  const wStepY = (p0x - p1x) * invArea;

  const fragment = shader.fragment;
  shader.bc = bcClip;
  shader.fragPos = fragPos;

  // Loop over pixels in bounding box
  for (let y = minY; y <= maxY; y++) {
    // Reset barycentric coordinates for this row
    let u = uRow;
    let v = vRow;
    let w = wRow;
    let index = minX + y * buffer.width;

    for (let x = minX; x <= maxX; x++) {
      // Check if pixel is inside triangle
      if (u >= 0 && v >= 0 && w >= 0) {
        // Interpolate depth to get z value at pixel
        const z = v0.z * u + v1.z * v + v2.z * w;

        // Check pixel's depth against z buffer, if pixel is closer, draw it
        if (z < depthBuffer.data[index]) {
          // Update z buffer with new depth
          depthBuffer.data[index] = z;

          // Skip if no fragment shader is defined (e.g. depth pass)
          if (fragment) {
            // Get perspective-correct barycentric coordinates
            const invW = 1 / (v0.w * u + v1.w * v + v2.w * w);
            bcClip.u = u * invW * v0.w;
            bcClip.v = v * invW * v1.w;
            bcClip.w = w * invW * v2.w;

            // Pass fragment screen position to fragment shader
            fragPos.x = x;
            fragPos.y = y;
            fragPos.z = z;

            const frag = fragment();

            // Skip if fragment shader discarded the pixel by returning undefined
            if (frag) {
              buffer.setPixel(x, y, frag);
            }
          }
        }
      }
      // Step to next pixel
      u += uStepX;
      v += vStepX;
      w += wStepX;
      index++;
    }
    // Step to next row
    uRow += uStepY;
    vRow += vStepY;
    wRow += wStepY;
  }
};
