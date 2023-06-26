import { DepthTexture, setPixel, viewportTransform } from ".";
import { Vector2, Vector4 } from "../maths";
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
  buffer: Uint8ClampedArray,
  imageDim: Vector2,
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
  const p0 = viewportTransform(v0, imageDim);
  const p1 = viewportTransform(v1, imageDim);
  const p2 = viewportTransform(v2, imageDim);

  // Calculate inverse signed area of triangle in screen space
  const invAreaSs = 1 / edgeFunction(p2, p1, p0);

  // Calculate bounding box
  let minX = ~~Math.max(0, Math.min(p0.x, p1.x, p2.x));
  let minY = ~~Math.max(0, Math.min(p0.y, p1.y, p2.y));
  let maxX = ~~Math.min(imageDim.x, Math.max(p0.x, p1.x, p2.x));
  let maxY = ~~Math.min(imageDim.y, Math.max(p0.y, p1.y, p2.y));

  // Calculate barycentric coordinates at top left corner of bounding box
  const minPos = new Vector4(minX, minY);
  let w0Row = edgeFunction(p2, p1, minPos) * invAreaSs;
  let w1Row = edgeFunction(p0, p2, minPos) * invAreaSs;
  let w2Row = edgeFunction(p1, p0, minPos) * invAreaSs;

  // Calculate step sizes for barycentric coordinates
  const w0Step = new Vector2(p1.y - p2.y, p2.x - p1.x).scaleInPlace(invAreaSs);
  const w1Step = new Vector2(p2.y - p0.y, p0.x - p2.x).scaleInPlace(invAreaSs);
  const w2Step = new Vector2(p0.y - p1.y, p1.x - p0.x).scaleInPlace(invAreaSs);

  // Loop over pixels in bounding box
  for (P.y = minY; P.y <= maxY; P.y++) {
    // Reset barycentric coordinates for this row
    bc.u = w0Row;
    bc.v = w1Row;
    bc.w = w2Row;

    for (P.x = minX; P.x <= maxX; P.x++) {
      // Skip pixel if outside triangle
      if (bc.u >= 0 && bc.v >= 0 && bc.w >= 0) {
        // Interpolate depth to get z value at pixel
        P.z = p0.z * bc.u + p1.z * bc.v + p2.z * bc.w;

        // Check pixel'z depth against z buffer, if pixel is closer, draw it
        const index = P.x + P.y * imageDim.x;
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
          if (frag) {
            // Set final pixel colour
            setPixel(P.x, P.y, imageDim, frag, buffer);
          }
        }
      }
      // Step barycentric coordinates along row
      bc.u += w0Step.x;
      bc.v += w1Step.x;
      bc.w += w2Step.x;
    }
    // Step barycentric coordinates along column
    w0Row += w0Step.y;
    w1Row += w1Step.y;
    w2Row += w2Step.y;
  }
};
