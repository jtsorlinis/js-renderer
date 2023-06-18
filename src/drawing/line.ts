import { viewportTransform, setPixel } from ".";
import { Vector3 } from "../maths";

const WHITE = new Vector3(1, 1, 1);

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
      setPixel(s.x, s.y, WHITE, image);
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
