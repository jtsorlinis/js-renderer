import { Framebuffer } from ".";
import { Vector3, Vector4 } from "../maths";

const WHITE = new Vector3(1, 1, 1);

// Bresenham's line algorithm
export const line = (start: Vector4, end: Vector4, buffer: Framebuffer) => {
  // Clip near and far planes
  if (start.z < -1 || end.z < -1) return;
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
  let err = dx - dy;

  while (true) {
    if (s.x >= 0 && s.x < buffer.width && s.y >= 0 && s.y < buffer.height) {
      buffer.setPixel(s.x, s.y, WHITE);
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
