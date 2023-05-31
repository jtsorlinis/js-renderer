import "./style.css";
import { Colour, Vector2, Vector3 } from "./types";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

let backBuffer = new ImageData(canvas.width, canvas.height);

const update = () => {};

const setPixel = (pos: Vector2, r: number, g: number, b: number) => {
  const index = (pos.x + pos.y * backBuffer.width) * 4;
  backBuffer.data[index + 0] = r;
  backBuffer.data[index + 1] = g;
  backBuffer.data[index + 2] = b;
  backBuffer.data[index + 3] = 255;
};

const line = (start: Vector2, end: Vector2, colour: Colour) => {
  let s = start.clone();
  let e = end.clone();
  const dx = Math.abs(e.x - s.x);
  const dy = Math.abs(e.y - s.y);
  const sx = s.x < e.x ? 1 : -1;
  const sy = s.y < e.y ? 1 : -1;
  let err = dx - dy;

  while (true) {
    setPixel(s, colour.r, colour.g, colour.b);

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

const barycentric = (p1: Vector2, p2: Vector2, p3: Vector2, P: Vector2) => {
  const v1 = new Vector3(p3.x - p1.x, p2.x - p1.x, p1.x - P.x);
  const v2 = new Vector3(p3.y - p1.y, p2.y - p1.y, p1.y - P.y);
  const u = v1.cross(v2);

  // Check for degenerate triangle
  if (Math.abs(u.z) < 1) return new Vector3(-1, 1, 1);

  return new Vector3(1 - (u.x + u.y) / u.z, u.y / u.z, u.x / u.z);
};

const triangle = (p0: Vector2, p1: Vector2, p2: Vector2, colour: Colour) => {
  let minX = Math.min(p0.x, p1.x, p2.x);
  let minY = Math.min(p0.y, p1.y, p2.y);
  let maxX = Math.max(p0.x, p1.x, p2.x);
  let maxY = Math.max(p0.y, p1.y, p2.y);
  for (let y = minY; y < maxY; y++) {
    for (let x = minX; x < maxX; x++) {
      const bcScreen = barycentric(p0, p1, p2, new Vector2(x, y));
      if (bcScreen.x < 0 || bcScreen.y < 0 || bcScreen.z < 0) continue;
      setPixel(new Vector2(x, y), colour.r, colour.g, colour.b);
    }
  }
};

const draw = () => {
  clear();
  let p0 = new Vector2(300, 400);
  let p1 = new Vector2(400, 200);
  let p2 = new Vector2(500, 400);
  triangle(p0, p1, p2, new Colour(255, 0, 0));
  triangle(
    new Vector2(100, 100),
    new Vector2(250, 150),
    new Vector2(150, 250),
    new Colour(0, 255, 0)
  );
  ctx.putImageData(backBuffer, 0, 0);
};

const clear = () => {
  backBuffer.data.fill(0);
  for (let i = 3; i < backBuffer.data.length; i += 4) {
    backBuffer.data[i] = 255;
  }
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  // console.log(dt);
  prevTime = now;
  update();
  draw();
  requestAnimationFrame(loop);
};

loop();
