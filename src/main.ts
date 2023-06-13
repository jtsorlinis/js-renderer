import "./style.css";
import { Matrix4, Vector3 } from "./maths";
import { clear, line, triangle } from "./drawing";
import { loadObj } from "./utils/objLoader";
import { PhongShader } from "./shaders/Phong";

import modelFile from "./models/head.obj?raw";
import { FlatShader } from "./shaders/Flat";
import { BaseShader } from "./shaders/BaseShader";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const orthographicCb = document.getElementById("orthoCb") as HTMLInputElement;
const shadingDd = document.getElementById("shadingDd") as HTMLSelectElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

// Setup canvas and zBuffer
const image = new ImageData(canvas.width, canvas.height);
const zBuffer = new Float32Array(canvas.width * canvas.height);

// Setup light
const lightDir = new Vector3(0, 0, 1);
const lightCol = new Vector3(1, 1, 1);

// Setup camera
const camPos = new Vector3(0, 0, -2.5);
let orthoSize = 1.5;

// Model
let model = loadObj(modelFile, true);
let modelRotation = new Vector3(0, 0, 0);
let modelPos = new Vector3(0, 0, 0);

// Setup shaders
const phongShader = new PhongShader(model);
const flatShader = new FlatShader(model);
let shader: BaseShader;

const update = (dt: number) => {
  modelRotation.y += dt / 5;
};

const draw = () => {
  clear(image, zBuffer);

  const camForward = camPos.add(Vector3.Forward);
  const viewMat = Matrix4.LookAt(camPos, camForward, Vector3.Up);
  const projMat = orthographicCb.checked
    ? Matrix4.Ortho(orthoSize, image)
    : Matrix4.Perspective(60, image);

  const modelMat = Matrix4.TRS(modelPos, modelRotation, Vector3.One);
  const rotMat = Matrix4.RotateEuler(modelRotation);
  const mvp = modelMat.multiply(viewMat.multiply(projMat));
  shader = shadingDd.value === "flat" ? flatShader : phongShader;
  shader.uniforms = { mvp, rotMat, lightDir, lightCol };

  for (let i = 0; i < model.vertices.length; i += 3) {
    const triVerts: Vector3[] = [];
    for (let j = 0; j < 3; j++) {
      triVerts[j] = shader.vertex(i + j, j);
    }

    // Draw wireframe
    if (shadingDd.value === "wireframe") {
      line(triVerts[0], triVerts[1], image);
      line(triVerts[1], triVerts[2], image);
      line(triVerts[2], triVerts[0], image);
      continue;
    }

    // Draw filled
    triangle(triVerts, shader.fragment, image, zBuffer);
  }
  ctx.putImageData(image, 0, 0);
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

canvas.onmousemove = (e) => {
  if (e.buttons === 1) {
    // left mouse button
    modelRotation.y += e.movementX / 250;
    modelRotation.x -= e.movementY / 250;
  } else if (e.buttons === 2 || e.buttons === 4) {
    // right mouse button
    modelPos.x += e.movementX / 250;
    modelPos.y -= e.movementY / 250;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  if (orthographicCb.checked) {
    orthoSize += e.deltaY / 100;
    orthoSize = Math.max(0.01, orthoSize);
  } else {
    camPos.z -= e.deltaY / 100;
  }
};

canvas.oncontextmenu = (e) => e.preventDefault();

fileInput.onchange = async () => {
  const file = fileInput.files && fileInput.files[0];
  if (!file) return;
  const data = await file.text();
  model = loadObj(data, true);
  modelRotation.set(0, 0, 0);
  modelPos.set(0, 0, 0);
};

loop();
