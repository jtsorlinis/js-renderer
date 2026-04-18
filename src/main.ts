import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { DepthTexture, Framebuffer, edgeFunction, line, triangle } from "./drawing";
import { getModelRadius } from "./utils/mesh";
import { ensureModelUrlOption, type ModelOption } from "./utils/modelLoader";
import { SmoothShader } from "./shaders/Smooth";
import { TexturedShader } from "./shaders/Textured";
import { GouraudShader } from "./shaders/Gouraud";
import { FlatShader } from "./shaders/Flat";
import { UnlitShader } from "./shaders/Unlit";
import { BaseShader } from "./shaders/BaseShader";
import { DepthShader } from "./shaders/Depth";
import { NormalMappedShader } from "./shaders/NormalMapped";
import { PbrShader } from "./shaders/Pbr";
import { IblShader } from "./shaders/Ibl";
import {
  buildEnvironmentIbl,
  estimateEnvironmentYaw,
  rebuildEnvironmentBackdrop,
} from "./shaders/iblHelpers";
import {
  SHADING_PRESETS,
  type RenderSelection,
  resolveShadingSelection,
  type RenderMode,
} from "./renderSettings";
import { loadHdrTexture } from "./utils/hdrLoader";

const FOV = 50;
const SHADOW_MAP_SIZE = 512;
const ROTATION_SPEED = 0.001;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;
const FPS_UPDATE_INTERVAL_MS = 250;
const RENDER_ASPECT_RATIO = 4 / 3;
const DEFAULT_SHADING_VALUE = "wireframe";
const DEFAULT_RENDER_SELECTION = resolveShadingSelection(DEFAULT_SHADING_VALUE);
const DEFAULT_RESOLUTION_HEIGHT = DEFAULT_RENDER_SELECTION.resolution ?? 600;
const DEFAULT_RESOLUTION_WIDTH = Math.round(DEFAULT_RESOLUTION_HEIGHT * RENDER_ASPECT_RATIO);
const DEFAULT_MODEL_URL = DEFAULT_RENDER_SELECTION.model;

if (!DEFAULT_MODEL_URL) {
  throw new Error("The default shading preset must define a model.");
}

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const resolutionText = document.getElementById("resolution") as HTMLSpanElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingSlider = document.getElementById("shadingSlider") as HTMLInputElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
let mouseButtonState = 0;
let hasDragged = false;

const renderShadingOptions = () => {
  const maxShadingIndex = Math.max(0, SHADING_PRESETS.length - 1);
  shadingList.replaceChildren();
  shadingList.style.setProperty("--shading-count", String(SHADING_PRESETS.length));
  shadingSlider.min = "0";
  shadingSlider.max = String(maxShadingIndex);

  for (const [index, preset] of SHADING_PRESETS.entries()) {
    const item = document.createElement("li");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "shading-option";
    button.dataset.shadingIndex = String(maxShadingIndex - index);
    button.dataset.shadingValue = preset.value;
    button.setAttribute("aria-pressed", "false");
    button.textContent = preset.label;
    item.appendChild(button);
    shadingList.appendChild(item);
  }
};

renderShadingOptions();

const getPresetIndex = () => {
  const maxShadingIndex = Math.max(0, SHADING_PRESETS.length - 1);
  return maxShadingIndex - Number(shadingSlider.value);
};

const getShadingButton = () => {
  return shadingList.querySelector<HTMLButtonElement>(
    `[data-shading-index="${shadingSlider.value}"]`,
  );
};

const getShadingValue = () => {
  const presetIndex = getPresetIndex();
  return SHADING_PRESETS[presetIndex]?.value ?? "wireframe";
};

const setShadingValue = (value: string) => {
  const maxShadingIndex = Math.max(0, SHADING_PRESETS.length - 1);
  const index = SHADING_PRESETS.findIndex((preset) => preset.value === value);
  shadingSlider.value = String(index >= 0 ? maxShadingIndex - index : maxShadingIndex);
  syncShadingButtons();
};

const syncShadingButtons = () => {
  const activeButton = getShadingButton();
  const previousButton = shadingList.querySelector<HTMLButtonElement>(".is-active");
  previousButton?.classList.remove("is-active");
  previousButton?.setAttribute("aria-pressed", "false");
  activeButton?.classList.add("is-active");
  activeButton?.setAttribute("aria-pressed", "true");
};

setShadingValue(DEFAULT_SHADING_VALUE);

const viewport = canvas.parentElement!;
const fitCanvas = () => {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  let w = vw;
  let h = w / RENDER_ASPECT_RATIO;
  if (h > vh) {
    h = vh;
    w = h * RENDER_ASPECT_RATIO;
  }
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(h)}px`;
};
let frameBuffer = new Framebuffer(DEFAULT_RESOLUTION_WIDTH, DEFAULT_RESOLUTION_HEIGHT);
let depthBuffer = new DepthTexture(DEFAULT_RESOLUTION_WIDTH, DEFAULT_RESOLUTION_HEIGHT);
let shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowBuffer = new Framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let bgBuffer = new Framebuffer(DEFAULT_RESOLUTION_WIDTH, DEFAULT_RESOLUTION_HEIGHT);

const setRenderResolution = (resolutionHeight: number) => {
  const height = resolutionHeight;
  const width = Math.round(height * RENDER_ASPECT_RATIO);

  canvas.width = width;
  canvas.height = height;
  frameBuffer = new Framebuffer(width, height);
  depthBuffer = new DepthTexture(width, height);
  shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  shadowBuffer = new Framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
  bgBuffer = new Framebuffer(width, height);
  fitCanvas();
};

const applyRenderResolution = (resolution?: number) => {
  setRenderResolution(resolution ?? DEFAULT_RESOLUTION_HEIGHT);
};

applyRenderResolution(DEFAULT_RENDER_SELECTION.resolution);
window.addEventListener("resize", fitCanvas);

const hdrEnvironment = await loadHdrTexture(`${import.meta.env.BASE_URL}environments/sunny.hdr`);

// Scene and camera
const lightDir = new Vector3(1, -1, 1).scale(-1).normalize();
const camPos = new Vector3(0, 0, -3);

// Derived scene data
const cameraLookDir = Vector3.Forward;
const envYaw = estimateEnvironmentYaw(hdrEnvironment, lightDir);
const iblData = buildEnvironmentIbl(hdrEnvironment);
rebuildEnvironmentBackdrop(bgBuffer, iblData, RENDER_ASPECT_RATIO, FOV, envYaw);

const initialModelOption = await ensureModelUrlOption(DEFAULT_MODEL_URL);

let model = initialModelOption.mesh;
let material = initialModelOption.material;
let shadowOrthoSize = getModelRadius(model);
let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, Math.PI / 2, 0);
let modelScale = new Vector3(1, 1, 1);

const shaders = {
  ibl: new IblShader(),
  pbr: new PbrShader(),
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  gouraudTextured: new GouraudShader(),
  gouraud: new GouraudShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
  unlit: new UnlitShader(),
  depth: new DepthShader(),
};

const triVerts: Vector4[] = [];
let activeRenderSettings = DEFAULT_RENDER_SELECTION;

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  resolutionText.innerText = `${activeRenderSettings.resolution}p`;
};

let activeModelRequest = 0;

const applyModelOption = (selectedModel: ModelOption) => {
  model = selectedModel.mesh;
  material = selectedModel.material;
  shadowOrthoSize = getModelRadius(model);
  updateModelStats();
  hasDragged = false;
};

const setModelSource = async (modelUrl: string) => {
  const requestId = ++activeModelRequest;
  const selectedModel = await ensureModelUrlOption(modelUrl);
  if (requestId !== activeModelRequest) {
    return false;
  }

  applyModelOption(selectedModel);
  return true;
};

const applyRenderSettings = async (selection: RenderSelection) => {
  const shadingValue = getShadingValue();
  if (selection.normalizedValue !== shadingValue) {
    setShadingValue(selection.normalizedValue);
  }

  if (selection.model) {
    const didApplyModel = await setModelSource(selection.model);
    if (!didApplyModel) {
      return;
    }
  }

  activeRenderSettings = selection;
  applyRenderResolution(selection.resolution);
  rebuildEnvironmentBackdrop(bgBuffer, iblData, RENDER_ASPECT_RATIO, FOV, envYaw);
  updateModelStats();
};

const applyCurrentShadingSelection = () => {
  const shadingValue = getShadingValue();
  const selection = resolveShadingSelection(shadingValue);
  applyRenderSettings(selection).catch((error) => {
    console.error(`Failed to apply shading preset "${selection.normalizedValue}"`, error);
  });
};

shadingList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest<HTMLButtonElement>(".shading-option");
  if (!button?.dataset.shadingIndex) {
    return;
  }

  shadingSlider.value = button.dataset.shadingIndex;
  syncShadingButtons();
  applyCurrentShadingSelection();
});

shadingSlider.addEventListener("input", () => {
  syncShadingButtons();
  applyCurrentShadingSelection();
});

const renderMesh = (
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  renderMode: RenderMode = "filled",
  targetBuffer: Framebuffer = frameBuffer,
  perspectiveCorrect: boolean = true,
  snapVertices: boolean = false,
  pixelFn = targetBuffer.setPixel,
) => {
  for (let i = 0; i < model.vertices.length; i += 3) {
    // Vertex stage for one triangle.
    for (let j = 0; j < 3; j++) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex().perspectiveDivide();
      if (snapVertices) {
        targetBuffer.snapToPixelGrid(triVerts[j]);
      }
    }

    if (renderMode !== "filled") {
      const isDepthWireframe = renderMode === "depthWireframe";
      const area = edgeFunction(triVerts[0], triVerts[1], triVerts[2]);
      if (isDepthWireframe && area <= 0) continue;

      line(triVerts[0], triVerts[1], targetBuffer, depthBuffer);
      line(triVerts[1], triVerts[2], targetBuffer, depthBuffer);
      line(triVerts[2], triVerts[0], targetBuffer, depthBuffer);
      continue;
    }

    // Rasterization + fragment stage.
    triangle(triVerts, activeShader, targetBuffer, depthBuffer, perspectiveCorrect, pixelFn);
  }
};

const update = () => {
  if (!hasDragged) {
    modelRotation.y = Math.cos(performance.now() * ROTATION_SPEED) * 0.5;
    modelRotation.x = 0;
  }
};

const draw = (dt: number) => {
  const renderSettings = activeRenderSettings;
  const perspectiveCorrect = renderSettings.perspectiveCorrect ?? true;
  const snapVertices = renderSettings.snapVertices ?? false;

  // 1) Clear all render targets for a new frame.
  if (renderSettings.showEnvironmentBackground) {
    frameBuffer.copyFrom(bgBuffer);
  } else if (renderSettings.vectorFade) {
    frameBuffer.fadeToBlack(dt * 6);
  } else {
    frameBuffer.clear();
  }
  depthBuffer.clear(1000);
  shadowMap.clear(1000);

  // 2) Build model-space transforms.
  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = invModelMat.transpose();

  // 3) Build light-space transform (for shadow mapping).
  const lightViewMat = Matrix4.LookAt(lightDir.scale(5), Vector3.Zero);
  const lightProjMat = Matrix4.Ortho(shadowOrthoSize, 1, 1, 10);
  const lightSpaceMat = lightProjMat.multiply(lightViewMat).multiply(modelMat);
  const modelLightDir = invModelMat.transformDirection(lightDir).normalize();
  const modelCamPos = invModelMat.transformPoint(camPos);

  // 4) Build camera transform and final clip transform.
  const viewMat = Matrix4.LookTo(camPos, cameraLookDir, Vector3.Up);
  const projMat = Matrix4.Perspective(FOV, RENDER_ASPECT_RATIO);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

  // 5) Select active material shader and update uniforms.
  const shader = shaders[renderSettings.material];

  shader.uniforms = {
    model,
    modelMat,
    mvp,
    normalMat,
    worldLightDir: lightDir,
    envYaw,
    modelLightDir,
    worldCamPos: camPos,
    modelCamPos,
    material,
    iblData,
    lightSpaceMat,
    shadowMap,
    receiveShadows: renderSettings.useShadows,
    useSpecular: renderSettings.useSpecular,
    disableTexture: renderSettings.disableTexture,
  };
  shaders.depth.uniforms = { model, clipMat: mvp };

  // Optional shadow pass first
  if (renderSettings.useShadows) {
    shaders.depth.uniforms.clipMat = lightSpaceMat;
    renderMesh(shaders.depth, shadowMap, "filled", shadowBuffer);
  }

  // We need a depth prepass for wireframe culling
  if (renderSettings.renderMode === "depthWireframe") {
    renderMesh(shaders.depth, depthBuffer, "filled");
  }

  const pixelFn = frameBuffer[renderSettings.setPixelFn ?? "setPixel"];

  // 6) Main render pass
  renderMesh(
    shader,
    depthBuffer,
    renderSettings.renderMode,
    frameBuffer,
    perspectiveCorrect,
    snapVertices,
    pixelFn,
  );
  ctx.putImageData(frameBuffer.imageData, 0, 0);
};

let prevTime = performance.now();
let lastFpsUiUpdate = prevTime;
const loop = () => {
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  prevTime = now;
  update();
  draw(dt);
  const actualFrameTime = performance.now() - now;

  if (now - lastFpsUiUpdate >= FPS_UPDATE_INTERVAL_MS) {
    const fps = 1000 / actualFrameTime;
    fpsText.innerText = `${actualFrameTime.toFixed(0)} ms (${fps.toFixed(0)} fps)`;
    lastFpsUiUpdate = now;
  }

  requestAnimationFrame(loop);
};

canvas.onpointerdown = (e) => {
  mouseButtonState = e.buttons;
};
window.onpointerup = (e) => {
  mouseButtonState = e.buttons;
};

let prevX = NaN;
let prevY = NaN;
canvas.onpointermove = (e) => {
  const dx = isNaN(prevX) ? 0 : e.clientX - prevX;
  const dy = isNaN(prevY) ? 0 : e.clientY - prevY;
  prevX = e.clientX;
  prevY = e.clientY;

  const dragging = mouseButtonState === 1;
  const panning = mouseButtonState === 2 || mouseButtonState === 4;

  if (dragging) {
    modelRotation.y -= dx / ROTATE_SENSITIVITY;
    modelRotation.x -= dy / ROTATE_SENSITIVITY;
    hasDragged = true;
  } else if (panning) {
    camPos.x -= dx / PAN_SENSITIVITY;
    camPos.y += dy / PAN_SENSITIVITY;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
};

canvas.oncontextmenu = (e) => e.preventDefault();

updateModelStats();
loop();
