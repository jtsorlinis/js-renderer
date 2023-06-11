import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { clear, line, triangle } from "./drawing";
import { loadObj } from "./utils/objLoader";
import obj from "./models/head.obj?raw";

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

// Model
const model = loadObj(obj);
let modelRotation = new Vector3(0, 0, 0);

const update = (dt: number) => {
  modelRotation.y += dt / 5;
};

const lightDir = new Vector3(0, 0, 1);
const lightCol = new Vector3(1, 1, 1);

const camPos = new Vector3(0, 0, -2.5);
let orthoSize = 1.5;

const vertShader = (v: Vector4, n: Vector4, mvp: Matrix4, rotMat: Matrix4) => {
  // Vertex transformation
  const position = mvp.multiplyAndPerpsectiveDivide(v);

  // Vertex lighting
  const rotatedNormal = rotMat.multiplyVector(n);
  const intensity = -rotatedNormal.xyz.dot(lightDir);
  const colour = lightCol.scale(intensity).toRGB();

  return { position, colour };
};

const draw = () => {
  clear(image, zBuffer);

  const camForward = camPos.add(Vector3.Forward);
  const viewMat = Matrix4.LookAt(camPos, camForward, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(orthoSize, image)
    : Matrix4.Perspective(60, image);

  const modelMat = Matrix4.TRS(Vector3.Zero, modelRotation, Vector3.One);
  const rotMat = Matrix4.RotateEuler(modelRotation);
  const mvp = modelMat.multiply(viewMat.multiply(projMat));

  for (let i = 0; i < model.vertices.length; i += 3) {
    const verts = [];
    for (let j = 0; j < 3; j++) {
      const vert = model.vertices[i + j];
      const norm = model.normals[i + j];
      verts[j] = vertShader(vert.toVec4(), norm.toVec4(), mvp, rotMat);
    }

    // Draw wireframe
    if (drawWireframe) {
      line(verts[0].position, verts[1].position, image);
      line(verts[1].position, verts[2].position, image);
      line(verts[2].position, verts[0].position, image);
      continue;
    }

    // Draw filled
    triangle(verts, zBuffer, image);
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
    modelRotation.y += e.movementX / 250;
    modelRotation.x -= e.movementY / 250;
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
