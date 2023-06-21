import "./style.css";
import { clear, setPixel } from "./drawing";
import { Vector2, Vector3 } from "./maths";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const scnalineCb = document.getElementById("scanlineCb") as HTMLInputElement;

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

const genTri = (pos: Vector2, size: number) => {
  const verts = [
    new Vector3(pos.x - size / 2, pos.y + size / 2, 0),
    new Vector3(pos.x, pos.y - size / 2, 0),
    new Vector3(pos.x + size / 2, pos.y + size / 2, 0),
  ];

  return verts;
};

const tris: Vector3[][] = [];
const noTris = 1000;
for (let i = 0; i < noTris; i++) {
  const tri = genTri(
    new Vector2(~~(Math.random() * imageDim.x), ~~(Math.random() * imageDim.y)),
    100
  );
  tris.push(tri);
}

// triangle colours
const cols = [new Vector3(1, 0, 0), new Vector3(0, 1, 0), new Vector3(0, 0, 1)];

const invSlope = (v0: number, v1: number, height: number) => (v0 - v1) / height;

const invSlopeVec3 = (v0: Vector3, v1: Vector3, height: number) =>
  new Vector3(
    invSlope(v0.x, v1.x, height),
    invSlope(v0.y, v1.y, height),
    invSlope(v0.z, v1.z, height)
  );

const calcStartEnd = (
  v0: number,
  v1: number,
  y: number,
  slopes: number[],
  heights: number[],
  secondHalf: boolean
) => {
  const start = v0 + y * slopes[1];
  const end = secondHalf
    ? v1 + (y - heights[0]) * slopes[2]
    : v0 + y * slopes[0];
  return [start, end];
};

const calcStartEndVec3 = (
  v0: Vector3,
  v1: Vector3,
  y: number,
  slopes: Vector3[],
  heights: number[],
  secondHalf: boolean
) => {
  const [xs, xe] = calcStartEnd(
    v0.x,
    v1.x,
    y,
    slopes.map((s) => s.x),
    heights,
    secondHalf
  );
  const [ys, ye] = calcStartEnd(
    v0.y,
    v1.y,
    y,
    slopes.map((s) => s.y),
    heights,
    secondHalf
  );
  const [zs, ze] = calcStartEnd(
    v0.z,
    v1.z,
    y,
    slopes.map((s) => s.z),
    heights,
    secondHalf
  );
  return [new Vector3(xs, ys, zs), new Vector3(xe, ye, ze)];
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

  // Split triangle into top and bottom half
  const height = verts[i2].y - verts[i0].y;
  const topHalfHeight = verts[i1].y - verts[i0].y;
  const botHalfHeight = verts[i2].y - verts[i1].y;
  const heights = [topHalfHeight, botHalfHeight, height];

  // Calculate inverse slopes
  const d01 = invSlope(verts[i1].x, verts[i0].x, topHalfHeight);
  const d02 = invSlope(verts[i2].x, verts[i0].x, height);
  const d12 = invSlope(verts[i2].x, verts[i1].x, botHalfHeight);
  const slopes = [d01, d02, d12];

  const c01 = invSlopeVec3(cols[i1], cols[i0], topHalfHeight);
  const c02 = invSlopeVec3(cols[i2], cols[i0], height);
  const c12 = invSlopeVec3(cols[i2], cols[i1], botHalfHeight);
  const colSlopes = [c01, c02, c12];

  // Loop through each row of the triangle
  for (let y = 0; y <= height; y++) {
    const secondHalf = y > topHalfHeight;
    let [xStart, xEnd] = calcStartEnd(
      verts[i0].x,
      verts[i1].x,
      y,
      slopes,
      heights,
      secondHalf
    );

    const [colStart, colEnd] = calcStartEndVec3(
      cols[i0],
      cols[i1],
      y,
      colSlopes,
      heights,
      secondHalf
    );

    if (xStart > xEnd) {
      for (let x = xEnd; x <= xStart; x++) {
        const t = (x - xStart) / (xEnd - xStart);
        const col = new Vector3(
          colStart.x + (colEnd.x - colStart.x) * t,
          colStart.y + (colEnd.y - colStart.y) * t,
          colStart.z + (colEnd.z - colStart.z) * t
        );
        setPixel(~~x, verts[i0].y + ~~y, imageDim, col, frameBuffer);
      }
    } else {
      for (let x = xStart; x <= xEnd; x++) {
        const t = (x - xStart) / (xEnd - xStart);
        const col = new Vector3(
          colStart.x + (colEnd.x - colStart.x) * t,
          colStart.y + (colEnd.y - colStart.y) * t,
          colStart.z + (colEnd.z - colStart.z) * t
        );
        setPixel(~~x, verts[i0].y + ~~y, imageDim, col, frameBuffer);
      }
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

  const topLeft = new Vector3(bBoxMinX, bBoxMinY);

  const a01 = v0.y - v1.y;
  const b01 = v1.x - v0.x;
  const a12 = v1.y - v2.y;
  const b12 = v2.x - v1.x;
  const a20 = v2.y - v0.y;
  const b20 = v0.x - v2.x;

  let w0Row = edgeFunction(v0, v1, topLeft);
  let w1Row = edgeFunction(v1, v2, topLeft);
  let w2Row = edgeFunction(v2, v0, topLeft);

  for (pos.y = bBoxMinY; pos.y <= bBoxMaxY; pos.y++) {
    let w0 = w0Row;
    let w1 = w1Row;
    let w2 = w2Row;
    for (pos.x = bBoxMinX; pos.x <= bBoxMaxX; pos.x++) {
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) {
        const bcx = w1 * invArea;
        const bcy = w2 * invArea;
        const bcz = w0 * invArea;

        interpCol.x = bcx * cols[0].x + bcy * cols[1].x + bcz * cols[2].x;
        interpCol.y = bcx * cols[0].y + bcy * cols[1].y + bcz * cols[2].y;
        interpCol.z = bcx * cols[0].z + bcy * cols[1].z + bcz * cols[2].z;

        setPixel(pos.x, pos.y, imageDim, interpCol, frameBuffer);
      }
      w0 += a01;
      w1 += a12;
      w2 += a20;
    }
    w0Row += b01;
    w1Row += b12;
    w2Row += b20;
  }
};

let rasterDuration = 0;
const draw = () => {
  const rasterize = scnalineCb.checked ? triangleScanline : triangleEdge;
  clear(frameBuffer);

  const start = performance.now();

  for (let tri of tris) {
    rasterize(tri);
  }

  rasterDuration = performance.now() - start;

  ctx.putImageData(image, 0, 0);
};

const loop = () => {
  draw();
  fpsText.innerText = rasterDuration.toFixed(1);
  requestAnimationFrame(loop);
};

loop();
