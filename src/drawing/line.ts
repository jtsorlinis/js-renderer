import { Framebuffer } from "./Framebuffer";
import { DepthTexture } from "./Texture";
import { Vector3, Vector4 } from "../maths";

const WHITE = new Vector3(1, 1, 1);
const depthEpsilon = 0.001;

// Bresenham's line algorithm
export const line = (
  start: Vector4,
  end: Vector4,
  buffer: Framebuffer,
  zBuffer?: DepthTexture,
) => {
  // Clip near and far planes
  if (start.z < 0 || end.z < 0) return;
  if (start.z > 1 || end.z > 1) return;

  // Clip lines that are fully outside the viewport
  if (start.x < -1 && end.x < -1) return;
  if (start.x > 1 && end.x > 1) return;
  if (start.y < -1 && end.y < -1) return;
  if (start.y > 1 && end.y > 1) return;

  // Viewport transform
  start = buffer.viewportTransform(start);
  end = buffer.viewportTransform(end);

  // Round to nearest pixel
  let s = start.truncate();
  let e = end.truncate();

  const dx = Math.abs(e.x - s.x);
  const dy = Math.abs(e.y - s.y);
  const sx = s.x < e.x ? 1 : -1;
  const sy = s.y < e.y ? 1 : -1;
  const steps = Math.max(dx, dy) || 1;
  const dz = (end.z - start.z) / steps;
  let z = start.z;
  let err = dx - dy;
  let step = 0;

  while (true) {
    if (s.x >= 0 && s.x < buffer.width && s.y >= 0 && s.y < buffer.height) {
      const index = s.x + s.y * buffer.width;
      if (!zBuffer || z <= zBuffer.data[index] + depthEpsilon) {
        buffer.setPixel(s.x, s.y, WHITE);
      }
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

    step++;
    z = start.z + dz * step;
  }
};
