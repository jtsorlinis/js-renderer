import { setPixel, viewportTransform } from ".";
import { Vector3 } from "../maths";
import { BaseShader } from "../shaders/BaseShader";

export interface Barycentric {
  u: number;
  v: number;
  w: number;
}

const edgeFunction = (a: Vector3, b: Vector3, c: Vector3) => {
  return (c.x - a.x) * (b.y - a.y) - (c.y - a.y) * (b.x - a.x);
};

// Only instantiate these once and reuse them
const P = new Vector3();
const bc: Barycentric = { u: 0, v: 0, w: 0 };

// Draw a triangle in screen space (pixels)
export const triangle = (
  verts: Vector3[],
  shader: BaseShader,
  image: ImageData,
  zBuffer: Float32Array
) => {
  // Extract vertex positions
  let v0 = verts[0];
  let v1 = verts[1];
  let v2 = verts[2];

  // Clip near and far planes
  if (v0.z < 0 || v1.z < 0 || v2.z < 0) return;
  if (v0.z > 1 || v1.z > 1 || v2.z > 1) return;

  // // Backface culling based on winding order
  const weight = edgeFunction(v0, v1, v2);
  if (weight <= 0) return;

  // Scale from [-1, 1] to [0, width] and [0, height]]
  const p0 = viewportTransform(v0, image);
  const p1 = viewportTransform(v1, image);
  const p2 = viewportTransform(v2, image);

  // Calculate signed area of triangle in screen space
  const invArea = 1 / edgeFunction(p2, p1, p0);

  // Calculate bounding box
  let minX = ~~Math.max(0, Math.min(p0.x, p1.x, p2.x));
  let minY = ~~Math.max(0, Math.min(p0.y, p1.y, p2.y));
  let maxX = ~~Math.min(image.width, Math.max(p0.x, p1.x, p2.x));
  let maxY = ~~Math.min(image.height, Math.max(p0.y, p1.y, p2.y));

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
      bc.w = 1 - bc.u - bc.v;

      // Interpolate depth to get z value at pixel
      P.z = p0.z * bc.u + p1.z * bc.v + p2.z * bc.w;

      // Check pixel'z depth against z buffer, if pixel is closer, draw it
      const index = P.x + P.y * image.width;
      if (P.z < zBuffer[index]) {
        // Fragment shader
        shader.bc = bc;
        const frag = shader.fragment();

        // If pixel is discarded, skip it
        if (!frag) continue;

        // Update z buffer with new depth
        zBuffer[index] = P.z;

        // Set final pixel colour
        setPixel(P.x, P.y, frag, image);
      }
    }
  }
};
