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

// Scanline algorithm
const triangleScanline = (verts: Vector3[]) => {
  let i0 = 0,
    i1 = 1,
    i2 = 2;

  // Sort vertices by y
  if (verts[i0].y > verts[i1].y) [i0, i1] = [i1, i0];
  if (verts[i0].y > verts[i2].y) [i0, i2] = [i2, i0];
  if (verts[i1].y > verts[i2].y) [i1, i2] = [i2, i1];

  // Split triangle into top and bottom half
  const height = verts[i2].y - verts[i0].y;
  const topHalfHeight = verts[i1].y - verts[i0].y;
  const botHalfHeight = verts[i2].y - verts[i1].y;

  // Calculate inverse slopes
  const invSlope0 = (verts[i2].x - verts[i0].x) / height;
  const invSlope1 = (verts[i1].x - verts[i0].x) / topHalfHeight;
  const invSlope2 = (verts[i2].x - verts[i1].x) / botHalfHeight;

  // Loop through each row of the triangle
  for (let y = 0; y <= height; y++) {
    const secondHalf = y > topHalfHeight;
    let xStart = verts[i0].x + y * invSlope0;
    let xEnd = secondHalf
      ? verts[i1].x + (y - topHalfHeight) * invSlope2
      : verts[i0].x + y * invSlope1;
    if (xStart > xEnd) {
      const temp = xStart;
      xStart = xEnd;
      xEnd = temp;
    }

    for (let x = xStart; x <= xEnd; x++) {
      setPixel(~~x, verts[i0].y + ~~y, imageDim, cols[0], frameBuffer);
    }
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
