import "./style.css";
import { Matrix4, Vector3 } from "./maths";
import { clear, line, viewportTransform, triangle } from "./drawing";
import { loadObj } from "./utils/objLoader";
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
let orthoSize = 1.5;

const draw = () => {
  clear(image, zBuffer);

  const camForward = camPos.add(Vector3.Forward);
  const viewMat = Matrix4.LookAt(camPos, camForward, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(orthoSize, image)
    : Matrix4.Perspective(60, image);
  const vp = viewMat.multiply(projMat);

  const modelMat = Matrix4.TRS(Vector3.Zero, headRot, Vector3.One);
  const mvp = modelMat.multiply(vp);

  for (let i = 0; i < headModel.faces.length; i++) {
    const face = headModel.faces[i];

    // Model space
    const m1 = headModel.vertices[face.x].toVec4();
    const m2 = headModel.vertices[face.y].toVec4();
    const m3 = headModel.vertices[face.z].toVec4();

    // World space
    const w1 = modelMat.multiplyVector(m1).xyz;
    const w2 = modelMat.multiplyVector(m2).xyz;
    const w3 = modelMat.multiplyVector(m3).xyz;

    // Clip space with perspective division by w
    const c1 = mvp.multiplyVector(m1).divideByW();
    const c2 = mvp.multiplyVector(m2).divideByW();
    const c3 = mvp.multiplyVector(m3).divideByW();

    // Screen space (From [-1, 1] to [0, width/height]])
    const v1 = viewportTransform(c1, image);
    const v2 = viewportTransform(c2, image);
    const v3 = viewportTransform(c3, image);

    // backface culling
    const ab = v2.subtract(v1);
    const ac = v3.subtract(v1);
    const n = ab.x * ac.y - ac.x * ab.y;
    if (n < 0) continue;

    // clip near and far planes
    if (v1.z < -1 || v2.z < -1 || v3.z < -1) continue;
    if (v1.z > 1 || v2.z > 1 || v3.z > 1) continue;

    if (drawWireframe) {
      // Draw wireframe
      line(v1, v2, Vector3.One.toRGB(), image);
      line(v2, v3, Vector3.One.toRGB(), image);
      line(v3, v1, Vector3.One.toRGB(), image);
    } else {
      // Super basic lighting
      const ab = w3.subtract(w1);
      const ac = w2.subtract(w1);
      const n = ab.cross(ac).normalize();
      const intensity = n.dot(lightDir);
      const col = new Vector3(intensity, intensity, intensity).toRGB();

      // Draw filled
      triangle(v1, v2, v3, zBuffer, col, image);
    }
  }
  ctx.putImageData(image, 0, 0);
};

orthographicCb.onchange = () => {
  isOrtho = orthographicCb.checked;
  camPos.z = -2.5;
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

canvas.onwheel = (e) => {
  if (isOrtho) {
    orthoSize += e.deltaY / 100;
  } else {
    camPos.z -= e.deltaY / 100;
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
