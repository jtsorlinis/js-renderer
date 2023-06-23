import "./style.css";
import { clear, setPixel } from "./image";
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

const tri = genTri(new Vector2(1000, 800), 1400);

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
  const d01 = (verts[i1].x - verts[i0].x) / topHalfHeight;
  const d02 = (verts[i2].x - verts[i0].x) / height;
  const d12 = (verts[i2].x - verts[i1].x) / botHalfHeight;

  const c01 = cols[i1].subtract(cols[i0]).scaleInPlace(1 / topHalfHeight);
  const c02 = cols[i2].subtract(cols[i0]).scaleInPlace(1 / height);
  const c12 = cols[i2].subtract(cols[i1]).scaleInPlace(1 / botHalfHeight);

  // Loop through each row of the triangle
  for (let y = 0; y <= height; y++) {
    const secondHalf = y > topHalfHeight;
    let xStart = verts[i0].x + y * d02;
    let xEnd = secondHalf
      ? verts[i1].x + (y - topHalfHeight) * d12
      : verts[i0].x + y * d01;

    let colStart = cols[i0].add(c02.scale(y));
    let colEnd = secondHalf
      ? cols[i1].add(c12.scale(y - topHalfHeight))
      : cols[i0].add(c01.scale(y));

    if (xStart > xEnd) {
      [xStart, xEnd] = [xEnd, xStart];
      [colStart, colEnd] = [colEnd, colStart];
    }

    const colLen = colEnd.subtract(colStart);

    for (let x = xStart; x <= xEnd; x++) {
      const t = (x - xStart) / (xEnd - xStart);
      const col = colStart.add(colLen.scale(t));
      setPixel(~~x, verts[i0].y + ~~y, imageDim, col, frameBuffer);
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

  const bBoxMinX = ~~Math.min(v0.x, v1.x, v2.x);
  const bBoxMaxX = ~~Math.max(v0.x, v1.x, v2.x);
  const bBoxMinY = ~~Math.min(v0.y, v1.y, v2.y);
  const bBoxMaxY = ~~Math.max(v0.y, v1.y, v2.y);

  const area = edgeFunction(v0, v1, v2);
  const invArea = 1 / area;

  const pos = new Vector3();
  const interpCol = new Vector3();

  const topLeft = new Vector3(bBoxMinX, bBoxMinY);

  let w0Row = edgeFunction(v0, v1, topLeft);
  let w1Row = edgeFunction(v1, v2, topLeft);
  let w2Row = edgeFunction(v2, v0, topLeft);

  const w0Step = new Vector2(v0.y - v1.y, v1.x - v0.x);
  const w1Step = new Vector2(v1.y - v2.y, v2.x - v1.x);
  const w2Step = new Vector2(v2.y - v0.y, v0.x - v2.x);

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
      w0 += w0Step.x;
      w1 += w1Step.x;
      w2 += w2Step.x;
    }
    w0Row += w0Step.y;
    w1Row += w1Step.y;
    w2Row += w2Step.y;
  }
};

let rasterDuration = 0;
const draw = () => {
  const rasterize = scnalineCb.checked ? triangleScanline : triangleEdge;
  clear(frameBuffer);

  const start = performance.now();

  rasterize(tri);

  rasterDuration = performance.now() - start;

  ctx.putImageData(image, 0, 0);
};

document.onkeydown = (e) => {
  if (e.key === " ") {
    scnalineCb.checked = !scnalineCb.checked;
  }
};

const loop = () => {
  draw();
  fpsText.innerText = rasterDuration.toFixed(1);
  requestAnimationFrame(loop);
};

loop();
