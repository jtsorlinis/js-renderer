import "./style.css";
import { Vector3 } from "./maths";
import { Colour, clear, line, triangle } from "./drawing";
import { loadObj } from "./utils/objLoader";
import { Matrix4 } from "./maths/Matrix4";
import headObj from "./models/head.obj?raw";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const wireframeCb = document.getElementById("wireframeCb") as HTMLInputElement;
const orthographicCb = document.getElementById("orthoCb") as HTMLInputElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

// Setup canvas and zBuffer
const image = new ImageData(canvas.width, canvas.height);
const zBuffer = new Float32Array(canvas.width * canvas.height);
const viewportTransform = Matrix4.Viewport(image);
let drawWireframe = wireframeCb.checked;
let isOrtho = orthographicCb.checked;

// Head model
const headModel = loadObj(headObj);
let headRot = new Vector3(0, 3.141, 0);

const update = (dt: number) => {
  headRot.y += dt / 5;
  // headRot.x += dt / 5;
  // headRot.z += dt / 5;
};

const lightDir = new Vector3(0, 0, 1);
const camPos = new Vector3(0, 0, -2.5);

const draw = () => {
  clear(image, zBuffer);

  const viewMat = Matrix4.LookAt(camPos, Vector3.Zero, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(1.5, image)
    : Matrix4.Perspective(60, image);
  const vp = viewMat.multiply(projMat);

  const modelMat = Matrix4.TRS(Vector3.Zero, headRot, Vector3.One);
  const mvp = modelMat.multiply(vp);

  for (let i = 0; i < headModel.faces.length; i++) {
    const face = headModel.faces[i];

    // Model space
    const m1 = headModel.vertices[face.x];
    const m2 = headModel.vertices[face.y];
    const m3 = headModel.vertices[face.z];

    // World space
    const w1 = modelMat.multiplyVector(m1);
    const w2 = modelMat.multiplyVector(m2);
    const w3 = modelMat.multiplyVector(m3);

    // Clip space
    const c1 = mvp.multiplyVector(m1);
    const c2 = mvp.multiplyVector(m2);
    const c3 = mvp.multiplyVector(m3);

    // Screen space
    const v1 = viewportTransform.multiplyVector(c1);
    const v2 = viewportTransform.multiplyVector(c2);
    const v3 = viewportTransform.multiplyVector(c3);

    if (drawWireframe) {
      // Draw wireframe
      line(v1, v2, new Colour(255, 255, 255), image);
      line(v2, v3, new Colour(255, 255, 255), image);
      line(v3, v1, new Colour(255, 255, 255), image);
    } else {
      // Draw filled
      const edge1 = w3.subtract(w1);
      const edge2 = w2.subtract(w1);
      const n = edge1.cross(edge2).normalize();
      const intensity = n.dot(lightDir);
      const col = new Colour(intensity * 255, intensity * 255, intensity * 255);
      triangle(v1, v2, v3, zBuffer, col, image);
    }
  }
  ctx.putImageData(image, 0, 0);
};

orthographicCb.onchange = () => {
  isOrtho = orthographicCb.checked;
};

wireframeCb.onchange = () => {
  drawWireframe = wireframeCb.checked;
};

canvas.onmousemove = (e) => {
  if (e.buttons === 1) {
    headRot.y += e.movementX / 250;
    headRot.x -= e.movementY / 250;
  }
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  fpsText.innerHTML = dt.toFixed(3);
  prevTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
};

loop();
