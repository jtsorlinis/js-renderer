import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import {
  DepthTexture,
  Framebuffer,
  Texture,
  edgeFunction,
  line,
  triangle,
} from "./drawing";
import { getModelRadius, LoadedModel, loadObj } from "./utils/objLoader";
import { SmoothShader } from "./shaders/Smooth";
import { TexturedShader } from "./shaders/Textured";
import { FlatShader } from "./shaders/Flat";
import { UnlitShader } from "./shaders/Unlit";
import { BaseShader } from "./shaders/BaseShader";
import { DepthShader } from "./shaders/DepthShader";
import { NormalMappedShader } from "./shaders/NormalMapped";
import { resolveShadingSelection, type RenderMode } from "./renderSettings";

import diceModelFile from "./models/dice.obj?raw";
import diceDiffuseTex from "./models/dice_diffuse.png";
import diceNormalTex from "./models/dice_normal.png";
import rockModelFile from "./models/rock.obj?raw";
import rockDiffuseTex from "./models/rock_diffuse.png";
import rockNormalTex from "./models/rock_normal.png";
import dogModelFile from "./models/dog.obj?raw";
import dogDiffuseTex from "./models/dog_diffuse.png";
import dogNormalTex from "./models/dog_normal.png";
import headModelFile from "./models/head.obj?raw";
import headDiffuseTex from "./models/head_diffuse.png";
import headNormalTex from "./models/head_normal.png";
import dragonModelFile from "./models/dragon.obj?raw";
import dragonDiffuseTex from "./models/dragon_diffuse.png";
import dragonNormalTex from "./models/dragon_normal.png";
import spartanModelFile from "./models/spartan.obj?raw";
import spartanDiffuseTex from "./models/spartan_diffuse.png";
import spartanNormalTex from "./models/spartan_normal.png";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SHADOW_MAP_SIZE = 512;
const ROTATION_SPEED = 5;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const orthographicCb = document.getElementById("orthoCb") as HTMLInputElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingSlider = document.getElementById(
  "shadingSlider",
) as HTMLInputElement;
const modelDd = document.getElementById("modelDd") as HTMLSelectElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;

const getShadingButton = () => {
  return shadingList.querySelector<HTMLButtonElement>(
    `[data-shading-index="${shadingSlider.value}"]`,
  );
};

const setShadingValue = (value: string) => {
  const button = shadingList.querySelector<HTMLButtonElement>(
    `[data-shading-value="${value}"]`,
  );
  shadingSlider.value = button?.dataset.shadingIndex || "0";
  syncShadingButtons();
};

const syncShadingButtons = () => {
  const activeButton = getShadingButton();
  const previousButton =
    shadingList.querySelector<HTMLButtonElement>(".is-active");
  previousButton?.classList.remove("is-active");
  previousButton?.setAttribute("aria-pressed", "false");
  activeButton?.classList.add("is-active");
  activeButton?.setAttribute("aria-pressed", "true");
};

syncShadingButtons();

shadingList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest(".shading-option") as HTMLButtonElement;
  shadingSlider.value = button?.dataset.shadingIndex || shadingSlider.value;
  syncShadingButtons();
});

shadingSlider.addEventListener("input", syncShadingButtons);

canvas.width = CANVAS_WIDTH;
canvas.height = CANVAS_HEIGHT;
const aspectRatio = canvas.width / canvas.height;

const viewport = canvas.parentElement!;
const fitCanvas = () => {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  let w = vw;
  let h = w / aspectRatio;
  if (h > vh) {
    h = vh;
    w = h * aspectRatio;
  }
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(h)}px`;
};
fitCanvas();
window.addEventListener("resize", fitCanvas);

// Software render targets
const imageData = new ImageData(canvas.width, canvas.height);
const frameBuffer = new Framebuffer(imageData);
const zBuffer = new DepthTexture(canvas.width, canvas.height);
const shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
const shadowImageData = new ImageData(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
const shadowBuffer = new Framebuffer(shadowImageData);

// Scene and camera
const lightDir = new Vector3(0, -1, 1).normalize();
const lightCol = new Vector3(1, 1, 1);

const camPos = new Vector3(0, 0, -2.5);
let cameraOrthoSize = 1.5;

// Mesh + textures
type ModelKey = "dice" | "rock" | "dog" | "head" | "dragon" | "spartan";
type ModelOption = {
  mesh: LoadedModel;
  texture: Texture;
  normalTexture: Texture;
};

const [
  diceTexture,
  diceNormalTexture,
  rockTexture,
  rockNormalTexture,
  dogTexture,
  dogNormalTexture,
  headTexture,
  headNormalTexture,
  dragonTexture,
  dragonNormalTexture,
  spartanTexture,
  spartanNormalTexture,
] = await Promise.all([
  Texture.Load(diceDiffuseTex),
  Texture.Load(diceNormalTex, true),
  Texture.Load(rockDiffuseTex),
  Texture.Load(rockNormalTex, true),
  Texture.Load(dogDiffuseTex),
  Texture.Load(dogNormalTex, true),
  Texture.Load(headDiffuseTex),
  Texture.Load(headNormalTex, true),
  Texture.Load(dragonDiffuseTex),
  Texture.Load(dragonNormalTex, true),
  Texture.Load(spartanDiffuseTex),
  Texture.Load(spartanNormalTex, true),
]);

const modelOptions: Record<ModelKey, ModelOption> = {
  dice: {
    mesh: loadObj(diceModelFile, true, 0.75),
    texture: diceTexture,
    normalTexture: diceNormalTexture,
  },
  rock: {
    mesh: loadObj(rockModelFile, true),
    texture: rockTexture,
    normalTexture: rockNormalTexture,
  },
  dog: {
    mesh: loadObj(dogModelFile, true, 1.1),
    texture: dogTexture,
    normalTexture: dogNormalTexture,
  },
  head: {
    mesh: loadObj(headModelFile, true),
    texture: headTexture,
    normalTexture: headNormalTexture,
  },
  dragon: {
    mesh: loadObj(dragonModelFile, true, 1.3),
    texture: dragonTexture,
    normalTexture: dragonNormalTexture,
  },
  spartan: {
    mesh: loadObj(spartanModelFile, true),
    texture: spartanTexture,
    normalTexture: spartanNormalTexture,
  },
};
let model = modelOptions.dice.mesh;
let texture = modelOptions.dice.texture;
let normalTexture = modelOptions.dice.normalTexture;
let shadowOrthoSize = getModelRadius(model);

let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, Math.PI / 2, 0);
let modelScale = new Vector3(1, 1, 1);

const shaders = {
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
  unlit: new UnlitShader(),
};

type ShaderKey = keyof typeof shaders;
type RenderSettings = {
  shaderKey: ShaderKey;
  renderMode: RenderMode;
  useShadows: boolean;
};

const depthShader = new DepthShader();
const triVerts: Vector4[] = [];

const updateTriangleCount = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
};

const resetModelTransform = () => {
  modelRotation.set(0, Math.PI / 2, 0);
  modelPos.set(0, 0, 0);
};

const setModel = (modelKey: ModelKey) => {
  const selectedModel = modelOptions[modelKey];
  model = selectedModel.mesh;
  texture = selectedModel.texture;
  normalTexture = selectedModel.normalTexture;
  shadowOrthoSize = getModelRadius(model);
  updateTriangleCount();
  resetModelTransform();
};

const getRenderSettings = (): RenderSettings => {
  const shadingValue = getShadingButton()?.dataset.shadingValue || "wireframe";
  const selection = resolveShadingSelection(
    shadingValue,
    texture.data.length > 0 && model.uvs.length > 0,
  );
  if (selection.normalizedValue !== shadingValue) {
    setShadingValue(selection.normalizedValue);
  }
  return {
    shaderKey: selection.material,
    renderMode: selection.renderMode,
    useShadows: selection.useShadows,
  };
};

const renderMesh = (
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  renderMode: RenderMode = "filled",
  targetBuffer: Framebuffer = frameBuffer,
) => {
  for (let i = 0; i < model.vertices.length; i += 3) {
    // Vertex stage for one triangle.
    for (let j = 0; j < 3; j++) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex();
    }

    if (renderMode !== "filled") {
      if (renderMode === "culledWireframe") {
        const p0 = targetBuffer.viewportTransform(triVerts[0]);
        const p1 = targetBuffer.viewportTransform(triVerts[1]);
        const p2 = targetBuffer.viewportTransform(triVerts[2]);
        if (edgeFunction(p2, p1, p0) <= 0) continue;
      }

      // Debug/teaching mode: draw triangle edges only.
      line(triVerts[0], triVerts[1], targetBuffer);
      line(triVerts[1], triVerts[2], targetBuffer);
      line(triVerts[2], triVerts[0], targetBuffer);
      continue;
    }

    // Rasterization + fragment stage.
    triangle(triVerts, activeShader, targetBuffer, depthBuffer);
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
  const lightViewMat = Matrix4.LookAt(lightDir.scale(-5), Vector3.Zero);
  const lightProjMat = Matrix4.Ortho(shadowOrthoSize, 1, 1, 10);
  const lightSpaceMat = lightProjMat.multiply(lightViewMat).multiply(modelMat);
  const mLightDir = invModelMat.multiplyDirection(lightDir).normalize();
  const mCamPos = invModelMat.multiplyPoint(camPos).xyz;

  // 4) Build camera transform and final clip transform.
  const viewMat = Matrix4.LookTo(camPos, Vector3.Forward, Vector3.Up);
  const projMat = orthographicCb.checked
    ? Matrix4.Ortho(cameraOrthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

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
    renderMesh(depthShader, shadowMap, "filled", shadowBuffer);
  }

  renderMesh(shader, zBuffer, renderSettings.renderMode);
  ctx.putImageData(imageData, 0, 0);
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
    modelRotation.x -= e.movementY / ROTATE_SENSITIVITY;
  } else if (e.buttons === 2 || e.buttons === 4) {
    camPos.x -= e.movementX / PAN_SENSITIVITY;
    camPos.y += e.movementY / PAN_SENSITIVITY;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  if (orthographicCb.checked) {
    cameraOrthoSize += e.deltaY / ZOOM_SENSITIVITY;
    cameraOrthoSize = Math.max(0.01, cameraOrthoSize);
  } else {
    camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
  }
};

canvas.oncontextmenu = (e) => e.preventDefault();

modelDd.onchange = () => {
  setModel(modelDd.value as ModelKey);
};

updateTriangleCount();
loop();
