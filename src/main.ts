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
let headRot = new Vector3(0, 0, 0);

const update = (dt: number) => {
  headRot.y += dt / 5;
  // headRot.x += dt / 5;
  // headRot.z += dt / 5;
};

const lightDir = new Vector3(0, 0, 1);
const lightCol = new Vector3(1, 1, 1);

const camPos = new Vector3(0, 0, -2.5);
let orthoSize = 1.5;

const draw = () => {
  clear(image, zBuffer);

  const camForward = camPos.add(Vector3.Forward);
  const viewMat = Matrix4.LookAt(camPos, camForward, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(orthoSize, image)
    : Matrix4.Perspective(60, image);

  const modelMat = Matrix4.TRS(Vector3.Zero, headRot, Vector3.One);
  const rotMat = Matrix4.RotateEuler(headRot);
  const mvp = modelMat.multiply(viewMat.multiply(projMat));

  for (let i = 0; i < headModel.vertices.length; i += 3) {
    // Model space
    const m1 = headModel.vertices[i].toVec4();
    const m2 = headModel.vertices[i + 1].toVec4();
    const m3 = headModel.vertices[i + 2].toVec4();

    // Clip space and perspective divide
    const c1 = mvp.multiplyVector(m1).divideByW();
    const c2 = mvp.multiplyVector(m2).divideByW();
    const c3 = mvp.multiplyVector(m3).divideByW();

    // Screen space (From [-1, 1] to [0, width/height]])
    const v1 = viewportTransform(c1, image);
    const v2 = viewportTransform(c2, image);
    const v3 = viewportTransform(c3, image);

    if (drawWireframe) {
      // Draw wireframe
      line(v1, v2, Vector3.One.toRGB(), image);
      line(v2, v3, Vector3.One.toRGB(), image);
      line(v3, v1, Vector3.One.toRGB(), image);
    } else {
      // Vertex lighting
      const n = headModel.normals[i].toVec4();
      const n2 = headModel.normals[i + 1].toVec4();
      const n3 = headModel.normals[i + 2].toVec4();

      // rotate normals
      const n1Rot = rotMat.multiplyVector(n);
      const n2Rot = rotMat.multiplyVector(n2);
      const n3Rot = rotMat.multiplyVector(n3);

      const intensity1 = -n1Rot.xyz.dot(lightDir);
      const intensity2 = -n2Rot.xyz.dot(lightDir);
      const intensity3 = -n3Rot.xyz.dot(lightDir);
      const col1 = lightCol.scale(intensity1).toRGB();
      const col2 = lightCol.scale(intensity2).toRGB();
      const col3 = lightCol.scale(intensity3).toRGB();

      // Draw filled
      triangle(v1, v2, v3, col1, col2, col3, zBuffer, image);
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
    orthoSize = Math.max(0.01, orthoSize);
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
