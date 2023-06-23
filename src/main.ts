import "./style.css";
import { Matrix4, Vector2, Vector3, Vector4 } from "./maths";
import {
  DepthTexture,
  Texture,
  clear,
  clearDepthTexture,
  line,
  triangle,
} from "./drawing";
import { loadObj } from "./utils/objLoader";
import { SmoothShader } from "./shaders/Smooth";
import { TexturedShader } from "./shaders/Textured";
import { FlatShader } from "./shaders/Flat";
import { BaseShader } from "./shaders/BaseShader";
import { DepthShader } from "./shaders/DepthShader";
import { NormalMappedShader } from "./shaders/NormalMapped";

import modelFile from "./models/head.obj?raw";
import diffuseTex from "./models/head_diffuse.png";
import normalTex from "./models/head_normal_w.png";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const orthographicCb = document.getElementById("orthoCb") as HTMLInputElement;
const shadingDd = document.getElementById("shadingDd") as HTMLSelectElement;
const fileInput = document.getElementById("fileInput") as HTMLInputElement;

const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

// Set canvas size
canvas.width = 800;
canvas.height = 600;
const imageDim = new Vector2(canvas.width, canvas.height);
const aspectRatio = imageDim.x / imageDim.y;

// Setup canvas and buffers
const image = new ImageData(imageDim.x, imageDim.y);
const frameBuffer = image.data;
const zBuffer = new DepthTexture(imageDim.x, imageDim.y);
const shadowMap = new DepthTexture(imageDim.x, imageDim.y);

// Setup light
const lightDir = new Vector3(0, 0, 1);
const lightCol = new Vector3(1, 1, 1);

// Setup camera
const camPos = new Vector3(0, 0, -2.5);
let orthoSize = 1.5;

// Model
let model = loadObj(modelFile, true);
let texture = new Texture();
await texture.setData(diffuseTex);
let normalTexture = new Texture();
await normalTexture.setData(normalTex);
trisText.innerText = (model.vertices.length / 3).toFixed(0);
let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, Math.PI, 0);
let modelScale = new Vector3(1, 1, 1);

// Setup shaders
const shaders = {
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
};
let shader: BaseShader;
const depthShader = new DepthShader();

const update = (dt: number) => {
  modelRotation.y += dt / 5;
};

const draw = () => {
  clear(frameBuffer);
  clearDepthTexture(zBuffer, 1000);
  clearDepthTexture(shadowMap, 1000);

  // Setup model and normal matrices
  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = modelMat.invert().transpose();

  // Setup light matrices
  const lightViewMat = Matrix4.LookAt(lightDir.scale(-5), lightDir, Vector3.Up);
  const lightProjMat = Matrix4.Ortho(orthoSize, aspectRatio);
  const lightSpaceMat = modelMat.multiply(lightViewMat.multiply(lightProjMat));
  const mLightDir = invModelMat.multiplyDirection(lightDir);

  // Setup view and projection matrices
  const camForward = camPos.add(Vector3.Forward);
  const viewMat = Matrix4.LookAt(camPos, camForward, Vector3.Up);
  const projMat = orthographicCb.checked
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mvp = modelMat.multiply(viewMat.multiply(projMat));

  // Set shader based on dropdown
  if (shadingDd.value !== "wireframe") {
    shader = shaders[shadingDd.value.split("-")[0] as keyof typeof shaders];
    lightDir.y = shadingDd.value.includes("shadows") ? -1 : 0;
  }

  // If the model has no texture or UVs, don't try to draw it textured
  const hasTexAndUVs = texture.data.length && model.uvs.length;
  if (
    !hasTexAndUVs &&
    (shadingDd.value.includes("textured") ||
      shadingDd.value.includes("normalMapped"))
  ) {
    shadingDd.value = "smooth";
    shader = shaders.smooth;
  }

  // Set shader uniforms
  depthShader.uniforms = { model, lightSpaceMat };
  shader.uniforms = {
    model,
    mvp,
    normalMat,
    lightDir,
    mLightDir,
    lightCol,
    texture,
    normalTexture,
    lightSpaceMat,
    shadowMap,
  };

  const triVerts: Vector4[] = [];

  if (shadingDd.value.includes("shadows")) {
    // Shadow pass
    for (let i = 0; i < model.vertices.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        depthShader.vertexId = i + j;
        depthShader.nthVert = j;
        triVerts[j] = depthShader.vertex();
      }

      triangle(triVerts, depthShader, frameBuffer, imageDim, shadowMap);
    }
  }

  // Final pass
  for (let i = 0; i < model.vertices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      shader.vertexId = i + j;
      shader.nthVert = j;
      triVerts[j] = shader.vertex();
    }

    // Draw wireframe
    if (shadingDd.value === "wireframe") {
      line(triVerts[0], triVerts[1], frameBuffer, imageDim);
      line(triVerts[1], triVerts[2], frameBuffer, imageDim);
      line(triVerts[2], triVerts[0], frameBuffer, imageDim);
      continue;
    }

    // Draw filled
    triangle(triVerts, shader, frameBuffer, imageDim, zBuffer);
  }
  ctx.putImageData(image, 0, 0);
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const dtms = now - prevTime;
  const dt = dtms / 1000;
  fpsText.innerText = dtms.toFixed(0);
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
  texture = new Texture();
  normalTexture = new Texture();
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  modelRotation.set(0, Math.PI / 2, 0);
  modelPos.set(0, 0, 0);
};

loop();
