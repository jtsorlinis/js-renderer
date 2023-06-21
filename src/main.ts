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
const verts = [
  new Vector3(imageDim.x * 0.1, imageDim.y * 0.9, 0),
  new Vector3(imageDim.x * 0.5, imageDim.y * 0.1, 0),
  new Vector3(imageDim.x * 0.9, imageDim.y * 0.9, 0),
];

// triangle colours
const cols = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];
const sCols: Vector3[] = [];

const fillBotTri = (v0: Vector3, v1: Vector3, v2: Vector3) => {
  let invSlope1 = (v1.x - v0.x) / (v1.y - v0.y);
  let invSlope2 = (v2.x - v0.x) / (v2.y - v0.y);

  let xStart = v0.x;
  let xEnd = v0.x;

  const cSlope1x = (sCols[1].x - sCols[0].x) / (v1.y - v0.y);
  const cSlope1y = (sCols[1].y - sCols[0].y) / (v1.y - v0.y);
  const cSlope1z = (sCols[1].z - sCols[0].z) / (v1.y - v0.y);

  const cSlope2x = (sCols[2].x - sCols[0].x) / (v2.y - v0.y);
  const cSlope2y = (sCols[2].y - sCols[0].y) / (v2.y - v0.y);
  const cSlope2z = (sCols[2].z - sCols[0].z) / (v2.y - v0.y);

  let cStartX = sCols[0].x;
  let cStartY = sCols[0].y;
  let cStartZ = sCols[0].z;

  let cEndX = sCols[0].x;
  let cEndY = sCols[0].y;
  let cEndZ = sCols[0].z;

  if (v1.x > v2.x) [invSlope1, invSlope2] = [invSlope2, invSlope1];

  for (let y = v0.y; y <= v1.y; y++) {
    for (let x = xStart; x <= xEnd; x++) {
      const t = (x - xStart) / (xEnd - xStart);
      const col = new Vector3(
        cStartX + (cEndX - cStartX) * t,
        cStartY + (cEndY - cStartY) * t,
        cStartZ + (cEndZ - cStartZ) * t
      );
      setPixel(~~x, ~~y, imageDim, col, frameBuffer);
    }
    xStart += invSlope1;
    xEnd += invSlope2;
    cStartX += cSlope1x;
    cStartY += cSlope1y;
    cStartZ += cSlope1z;
    cEndX += cSlope2x;
    cEndY += cSlope2y;
    cEndZ += cSlope2z;
  }
};

const fillTopTri = (v0: Vector3, v1: Vector3, v2: Vector3) => {
  let invSlope1 = (v2.x - v0.x) / (v2.y - v0.y);
  let invSlope2 = (v2.x - v1.x) / (v2.y - v1.y);

  let xStart = v2.x;
  let xEnd = v2.x;

  if (v0.x > v1.x) [invSlope1, invSlope2] = [invSlope2, invSlope1];

  for (let y = v2.y; y > v0.y; y--) {
    // if (xStart > xEnd) [xStart, xEnd] = [xEnd, xStart];
    for (let x = xStart; x <= xEnd; x++) {
      setPixel(~~x, ~~y, imageDim, sCols[0], frameBuffer);
    }
    xStart -= invSlope1;
    xEnd -= invSlope2;
  }
};

// Scanline algorithm
const triangleScanline = (verts: Vector3[]) => {
  let i0 = 0,
    i1 = 1,
    i2 = 2;

  // Sort vertices by y
  if (verts[i0].y > verts[i1].y) [i0, i1] = [i1, i0];
  if (verts[i0].y > verts[i2].y) [i0, i2] = [i2, i0];
  if (verts[i1].y > verts[i2].y) [i1, i2] = [i2, i1];

  const v0 = verts[i0];
  const v1 = verts[i1];
  const v2 = verts[i2];

  sCols[0] = cols[i0];
  sCols[1] = cols[i1];
  sCols[2] = cols[i2];

  if (v1.y === v2.y) {
    fillBotTri(v0, v1, v2);
  } else if (v0.y === v1.y) {
    fillTopTri(v0, v1, v2);
  } else {
    const ratio = (v1.y - v0.y) / (v2.y - v0.y);
    const width = v2.x - v0.x;
    const v3 = new Vector3(v0.x + ratio * width, v1.y, 0);
    fillBotTri(v0, v1, v3);
    fillTopTri(v1, v3, v2);
  }
};

// Edge function for edge algorithm
const edgeFunction = (a: Vector3, b: Vector3, c: Vector3) => {
  return (c.x - a.x) * (a.y - b.y) - (c.y - a.y) * (a.x - b.x);
};

// Barycentric/Edge algorithm
const triangleEdge = (verts: Vector3[]) => {
  const v0 = verts[0];
  const v1 = verts[1];
  const v2 = verts[2];

  const bBoxMinX = Math.min(v0.x, v1.x, v2.x);
  const bBoxMaxX = Math.max(v0.x, v1.x, v2.x);
  const bBoxMinY = Math.min(v0.y, v1.y, v2.y);
  const bBoxMaxY = Math.max(v0.y, v1.y, v2.y);

  const area = edgeFunction(v0, v1, v2);
  const invArea = 1 / area;

  const pos = new Vector3();
  const interpCol = new Vector3();

  for (pos.y = bBoxMinY; pos.y <= bBoxMaxY; pos.y++) {
    for (pos.x = bBoxMinX; pos.x <= bBoxMaxX; pos.x++) {
      const w0 = edgeFunction(v0, v1, pos);
      const w1 = edgeFunction(v1, v2, pos);
      const w2 = edgeFunction(v2, v0, pos);

      if (w0 < 0 || w1 < 0 || w2 < 0) continue;

      const bcx = w1 * invArea;
      const bcy = w2 * invArea;
      const bcz = w0 * invArea;

      interpCol.x = bcx * cols[0].x + bcy * cols[1].x + bcz * cols[2].x;
      interpCol.y = bcx * cols[0].y + bcy * cols[1].y + bcz * cols[2].y;
      interpCol.z = bcx * cols[0].z + bcy * cols[1].z + bcz * cols[2].z;

      setPixel(pos.x, pos.y, imageDim, interpCol, frameBuffer);
    }
  }
};

let rasterDuration = 0;
const draw = () => {
  clear(frameBuffer);

  const start = performance.now();

  // Fill triangle with edge algorithm
  // triangleEdge(verts);
  triangleScanline(verts);

  rasterDuration = performance.now() - start;

  ctx.putImageData(image, 0, 0);
};

const loop = () => {
  draw();
  fpsText.innerText = rasterDuration.toFixed(1);
  requestAnimationFrame(loop);
};

loop();
