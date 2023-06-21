import "./style.css";
import { clear, setPixel } from "./drawing";
import { Vector2, Vector3 } from "./maths";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

// Set canvas size
canvas.width = 2000;
canvas.height = 1600;

// Setup canvas and zBuffer
const imageDim = new Vector2(canvas.width, canvas.height);
const image = new ImageData(imageDim.x, imageDim.y);
const frameBuffer = image.data;

// triangle positions
const p0 = new Vector3(imageDim.x * 0.1, imageDim.y * 0.9, 0);
const p1 = new Vector3(imageDim.x * 0.5, imageDim.y * 0.1, 0);
const p2 = new Vector3(imageDim.x * 0.9, imageDim.y * 0.9, 0);

// triangle colours
const c0 = new Vector3(1, 0, 0);
const c1 = new Vector3(0, 1, 0);
const c2 = new Vector3(0, 0, 1);

const edgeFunction = (a: Vector3, b: Vector3, c: Vector3) => {
  return (c.x - a.x) * (a.y - b.y) - (c.y - a.y) * (a.x - b.x);
};

const triangleScanline = (p0: Vector3, p1: Vector3, p2: Vector3) => {
  const verts = [p0, p1, p2].sort((a, b) => a.y - b.y);

  const height = verts[2].y - verts[0].y;

  // Split triangle into top and bottom half
  let segmentHeight = verts[1].y - verts[0].y;

  let invSlope0 = (verts[2].x - verts[0].x) / height;
  let invSlope1 = (verts[1].x - verts[0].x) / segmentHeight;
  if (invSlope0 > invSlope1) {
    [invSlope0, invSlope1] = [invSlope1, invSlope0];
  }

  let xStart = verts[0].x;
  let xEnd = verts[0].x;
  for (let y = verts[0].y; y <= verts[1].y; y++) {
    xStart += invSlope0;
    xEnd += invSlope1;
    for (let x = xStart; x <= xEnd; x++) {
      setPixel(~~x, ~~y, imageDim, c0, frameBuffer);
    }
  }

  // Bottom half
  segmentHeight = verts[2].y - verts[1].y;
  invSlope0 = (verts[2].x - verts[1].x) / segmentHeight;
  invSlope1 = (verts[2].x - verts[0].x) / height;
  if (invSlope0 < invSlope1) {
    [invSlope0, invSlope1] = [invSlope1, invSlope0];
  }

  for (let y = verts[1].y; y <= verts[2].y; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      setPixel(~~x, ~~y, imageDim, c1, frameBuffer);
    }
    xStart += invSlope0;
    xEnd += invSlope1;
  }
};

// Barycentric/Edge algorithm
const triangleEdge = (p0: Vector3, p1: Vector3, p2: Vector3) => {
  const bBoxMinX = Math.min(p0.x, p1.x, p2.x);
  const bBoxMaxX = Math.max(p0.x, p1.x, p2.x);
  const bBoxMinY = Math.min(p0.y, p1.y, p2.y);
  const bBoxMaxY = Math.max(p0.y, p1.y, p2.y);

  const area = edgeFunction(p0, p1, p2);
  const invArea = 1 / area;

  const pos = new Vector3();
  const interpCol = new Vector3();

  for (pos.y = bBoxMinY; pos.y <= bBoxMaxY; pos.y++) {
    for (pos.x = bBoxMinX; pos.x <= bBoxMaxX; pos.x++) {
      const w0 = edgeFunction(p0, p1, pos);
      const w1 = edgeFunction(p1, p2, pos);
      const w2 = edgeFunction(p2, p0, pos);

      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const bcx = w1 * invArea;
      const bcy = w2 * invArea;
      const bcz = w0 * invArea;

      interpCol.x = bcx * c0.x + bcy * c1.x + bcz * c2.x;
      interpCol.y = bcx * c0.y + bcy * c1.y + bcz * c2.y;
      interpCol.z = bcx * c0.z + bcy * c1.z + bcz * c2.z;

      setPixel(pos.x, pos.y, imageDim, interpCol, frameBuffer);
    }
  }
};

let rasterDuration = 0;
const draw = () => {
  clear(frameBuffer);

  const start = performance.now();

  // Fill triangle with edge algorithm
  // triangleEdge(p0, p1, p2);
  triangleScanline(p0, p1, p2);

  rasterDuration = performance.now() - start;

  ctx.putImageData(image, 0, 0);
};

const loop = () => {
  draw();
  fpsText.innerText = rasterDuration.toFixed(1);
  requestAnimationFrame(loop);
};

loop();
