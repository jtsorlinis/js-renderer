import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { DepthTexture, Framebuffer, Texture, line, triangle } from "./drawing";
import { loadObj } from "./utils/objLoader";
import { SmoothShader } from "./shaders/Smooth";
import { TexturedShader } from "./shaders/Textured";
import { FlatShader } from "./shaders/Flat";
import { BaseShader } from "./shaders/BaseShader";
import { DepthShader } from "./shaders/DepthShader";
import { NormalMappedShader } from "./shaders/NormalMapped";
import { resolveShadingSelection } from "./renderSettings";

import modelFile from "./models/head.obj?raw";
import diffuseTex from "./models/head_diffuse.png";
import normalTex from "./models/head_normal_t.png";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const ROTATION_SPEED = 5;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;

// UI handles
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

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const aspectRatio = canvas.width / canvas.height;

// Software render targets
const image = new ImageData(canvas.width, canvas.height);
const frameBuffer = new Framebuffer(image);
const zBuffer = new DepthTexture(canvas.width, canvas.height);
const shadowMap = new DepthTexture(canvas.width, canvas.height);

// Scene and camera
const lightDir = new Vector3(0, -1, 1).normalize();
const lightCol = new Vector3(1, 1, 1);

const camPos = new Vector3(0, 0, -2.5);
let orthoSize = 1.5;

// Mesh + textures
let model = loadObj(modelFile, true);
let texture = await Texture.Load(diffuseTex);
let normalTexture = await Texture.Load(normalTex, true);

let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, -Math.PI / 2, 0);
let modelScale = new Vector3(1, 1, 1);

const shaders = {
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
};

type ShaderKey = keyof typeof shaders;
type RenderSettings = {
  shaderKey: ShaderKey;
  wireframe: boolean;
  useShadows: boolean;
};

const depthShader = new DepthShader();
const triVerts: Vector4[] = [];

const updateTriangleCount = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
};

const resetModelTransform = () => {
  modelRotation.set(0, -Math.PI / 2, 0);
  modelPos.set(0, 0, 0);
};

const getRenderSettings = (): RenderSettings => {
  const selection = resolveShadingSelection(
    shadingDd.value,
    texture.data.length > 0 && model.uvs.length > 0,
  );
  if (selection.normalizedValue !== shadingDd.value) {
    shadingDd.value = selection.normalizedValue;
  }
  return {
    shaderKey: selection.material,
    wireframe: selection.wireframe,
    useShadows: selection.useShadows,
  };
};

const renderMesh = (
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  wireframe = false,
) => {
  for (let i = 0; i < model.vertices.length; i += 3) {
    // Vertex stage for one triangle.
    for (let j = 0; j < 3; j++) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex();
    }

    if (wireframe) {
      // Debug/teaching mode: draw triangle edges only.
      line(triVerts[0], triVerts[1], frameBuffer);
      line(triVerts[1], triVerts[2], frameBuffer);
      line(triVerts[2], triVerts[0], frameBuffer);
      continue;
    }

    // Rasterization + fragment stage.
    triangle(triVerts, activeShader, frameBuffer, depthBuffer);
  }
};

const update = (dt: number) => {
  modelRotation.y -= dt / ROTATION_SPEED;
};

const draw = () => {
  // 1) Clear all render targets for a new frame.
  frameBuffer.clear();
  zBuffer.clear(1000);
  shadowMap.clear(1000);

  const renderSettings = getRenderSettings();

  // 2) Build model-space transforms.
  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = modelMat.invert().transpose();

  // 3) Build light-space transform (for shadow mapping).
  const lightViewMat = Matrix4.LookTo(lightDir.scale(-5), lightDir, Vector3.Up);
  const lightProjMat = Matrix4.Ortho(orthoSize, aspectRatio);
  const lightSpaceMat = modelMat.multiply(lightViewMat.multiply(lightProjMat));
  const mLightDir = invModelMat.multiplyDirection(lightDir).normalize();
  const mCamPos = invModelMat.multiplyPoint(camPos).xyz;

  // 4) Build camera transform and final clip transform.
  const viewMat = Matrix4.LookTo(camPos, Vector3.Forward, Vector3.Up);
  const projMat = orthographicCb.checked
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mvp = modelMat.multiply(viewMat).multiply(projMat);

  // 5) Select active material shader and update uniforms.
  const shader = shaders[renderSettings.shaderKey];

  depthShader.uniforms = { model, lightSpaceMat };
  shader.uniforms = {
    model,
    modelMat,
    mvp,
    normalMat,
    lightDir,
    mLightDir,
    lightCol,
    camPos,
    mCamPos,
    texture,
    normalTexture,
    lightSpaceMat,
    shadowMap,
  };

  // 6) Optional shadow pass first, then visible color pass.
  if (renderSettings.useShadows) {
    renderMesh(depthShader, shadowMap);
  }

  renderMesh(shader, zBuffer, renderSettings.wireframe);
  ctx.putImageData(image, 0, 0);
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const deltaTime = (now - prevTime) / 1000;
  prevTime = now;
  update(deltaTime);
  draw();
  const actualFrameTime = performance.now() - now;
  fpsText.innerText = actualFrameTime.toFixed(0);
  requestAnimationFrame(loop);
};

canvas.onmousemove = (e) => {
  if (e.buttons === 1) {
    modelRotation.y -= e.movementX / ROTATE_SENSITIVITY;
    modelRotation.x += e.movementY / ROTATE_SENSITIVITY;
  } else if (e.buttons === 2 || e.buttons === 4) {
    modelPos.x += e.movementX / PAN_SENSITIVITY;
    modelPos.y -= e.movementY / PAN_SENSITIVITY;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  if (orthographicCb.checked) {
    orthoSize += e.deltaY / ZOOM_SENSITIVITY;
    orthoSize = Math.max(0.01, orthoSize);
  } else {
    camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
  }
};

canvas.oncontextmenu = (e) => e.preventDefault();

fileInput.onchange = async () => {
  const file = fileInput.files?.[0];
  if (!file) return;

  const data = await file.text();
  model = loadObj(data, true);

  // Uploaded OBJ files may not have textures/UVs.
  // Clearing these arrays allows getRenderSettings() to gracefully
  // downgrade textured modes to smooth shading.
  texture.data = [];
  normalTexture.data = [];
  updateTriangleCount();
  resetModelTransform();
};

updateTriangleCount();
loop();
