import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { DepthTexture, Framebuffer, edgeFunction, line, triangle } from "./drawing";
import { getModelRadius } from "./utils/mesh";
import {
  ensureModelOption,
  loadCustomGlb,
  prefetchRemainingModels,
  type ModelKey,
  type ModelOption,
} from "./utils/modelLoader";
import { SmoothShader } from "./shaders/Smooth";
import { TexturedShader } from "./shaders/Textured";
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
import { RenderSelection, resolveShadingSelection, type RenderMode } from "./renderSettings";
import { loadHdrTexture } from "./utils/hdrLoader";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const FOV = 50;
const SHADOW_MAP_SIZE = 512;
const ROTATION_SPEED = 0.2;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;
const FPS_UPDATE_INTERVAL_MS = 250;
const INITIAL_MODEL: ModelKey = "dice";

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const orthoCb = document.getElementById("orthoCb") as HTMLInputElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const resolutionText = document.getElementById("resolution") as HTMLSpanElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingSlider = document.getElementById("shadingSlider") as HTMLInputElement;
const modelDd = document.getElementById("modelDd") as HTMLSelectElement;
const loadGlbBtn = document.getElementById("loadGlbBtn") as HTMLButtonElement;
const glbInput = document.getElementById("glbInput") as HTMLInputElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
let mouseButtonState = 0;

const getShadingButton = () => {
  return shadingList.querySelector<HTMLButtonElement>(
    `[data-shading-index="${shadingSlider.value}"]`,
  );
};

const setShadingValue = (value: string) => {
  const button = shadingList.querySelector<HTMLButtonElement>(`[data-shading-value="${value}"]`);
  shadingSlider.value = button?.dataset.shadingIndex || "0";
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

syncShadingButtons();

shadingList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest(".shading-option") as HTMLButtonElement;
  shadingSlider.value = button?.dataset.shadingIndex || shadingSlider.value;
  syncShadingButtons();
});

shadingSlider.addEventListener("input", syncShadingButtons);

let aspectRatio = CANVAS_WIDTH / CANVAS_HEIGHT;

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
let imageData = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
let frameBuffer = new Framebuffer(imageData);
let depthBuffer = new DepthTexture(CANVAS_WIDTH, CANVAS_HEIGHT);
let shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowImageData = new ImageData(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowBuffer = new Framebuffer(shadowImageData);
let bgImageData = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
let bgBuffer = new Framebuffer(bgImageData);

const setRenderResolution = (scale = 1) => {
  const width = CANVAS_WIDTH * scale;
  const height = CANVAS_HEIGHT * scale;
  const shadowMapSize = SHADOW_MAP_SIZE * scale;

  canvas.width = width;
  canvas.height = height;
  aspectRatio = width / height;
  imageData = new ImageData(width, height);
  frameBuffer = new Framebuffer(imageData);
  depthBuffer = new DepthTexture(width, height);
  shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
  shadowImageData = new ImageData(shadowMapSize, shadowMapSize);
  shadowBuffer = new Framebuffer(shadowImageData);
  bgImageData = new ImageData(width, height);
  bgBuffer = new Framebuffer(bgImageData);
  fitCanvas();
};

setRenderResolution();
window.addEventListener("resize", fitCanvas);

const hdrEnvironment = await loadHdrTexture(`${import.meta.env.BASE_URL}environments/sunny.hdr`);

// Scene and camera
const lightDir = new Vector3(1, -1, 1).scale(-1).normalize();
const camPos = new Vector3(0, 0, -3);
let orthoSize = -camPos.z * Math.tan((FOV * Math.PI) / 180 / 2);

// Derived scene data
const cameraLookDir = Vector3.Forward;
const viewDir = cameraLookDir.scale(-1);
const envYaw = estimateEnvironmentYaw(hdrEnvironment, lightDir);
const iblData = buildEnvironmentIbl(hdrEnvironment);
rebuildEnvironmentBackdrop(bgBuffer, iblData, aspectRatio, FOV, envYaw);

const initialModelOption = await ensureModelOption(INITIAL_MODEL);
modelDd.value = INITIAL_MODEL;
prefetchRemainingModels(INITIAL_MODEL);

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
  smooth: new SmoothShader(),
  flat: new FlatShader(),
  unlit: new UnlitShader(),
  depth: new DepthShader(),
};

type RenderSettings = Omit<RenderSelection, "normalizedValue">;

const triVerts: Vector4[] = [];

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  resolutionText.innerText = `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`;
};

const resetModelTransform = () => {
  modelRotation.set(0, Math.PI / 2, 0);
  camPos.set(0, 0, -3);
  orthoSize = -camPos.z * Math.tan((FOV * Math.PI) / 180 / 2);
};

let activeModelRequest = 0;

const applyModelOption = (selectedModel: ModelOption) => {
  model = selectedModel.mesh;
  material = selectedModel.material;
  shadowOrthoSize = getModelRadius(model);
  updateModelStats();
};

const setModel = async (modelKey: ModelKey, resetTransform = true) => {
  const requestId = ++activeModelRequest;
  const selectedModel = await ensureModelOption(modelKey);
  if (requestId !== activeModelRequest) {
    return;
  }

  applyModelOption(selectedModel);
  if (resetTransform) {
    resetModelTransform();
  }
};

const loadSelectedGlb = async (file: File, resetTransform = true) => {
  const requestId = ++activeModelRequest;
  const selectedModel = await loadCustomGlb(file);
  if (requestId !== activeModelRequest) {
    return;
  }

  applyModelOption(selectedModel);
  if (resetTransform) {
    resetModelTransform();
  }
};

const getRenderSettings = (): RenderSettings => {
  const shadingValue = getShadingButton()?.dataset.shadingValue || "wireframe";
  const selection = resolveShadingSelection(shadingValue);
  if (selection.normalizedValue !== shadingValue) {
    setShadingValue(selection.normalizedValue);
  }
  return {
    material: selection.material,
    renderMode: selection.renderMode,
    useShadows: selection.useShadows,
    showEnvironmentBackground: selection.showEnvironmentBackground,
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
      triVerts[j] = activeShader.vertex().perspectiveDivide();
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
    triangle(triVerts, activeShader, targetBuffer, depthBuffer);
  }
};

const update = (dt: number) => {
  if (mouseButtonState !== 1) {
    modelRotation.y -= dt * ROTATION_SPEED;
  }
};

const draw = () => {
  const renderSettings = getRenderSettings();

  // 1) Clear all render targets for a new frame.
  if (renderSettings.showEnvironmentBackground) {
    frameBuffer.copyFrom(bgBuffer);
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
  const modelViewDir = invModelMat.transformDirection(viewDir).normalize();

  // 4) Build camera transform and final clip transform.
  const isOrtho = orthoCb.checked;
  const viewMat = Matrix4.LookTo(camPos, cameraLookDir, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(FOV, aspectRatio);
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
    orthographic: isOrtho,
    worldViewDir: viewDir,
    modelViewDir,
    material,
    iblData,
    lightSpaceMat,
    shadowMap,
    receiveShadows: renderSettings.useShadows,
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

  // 6) Main render pass
  renderMesh(shader, depthBuffer, renderSettings.renderMode);
  ctx.putImageData(imageData, 0, 0);
};

let prevTime = performance.now();
let lastFpsUiUpdate = prevTime;
const loop = () => {
  const now = performance.now();
  const frameIntervalMs = now - prevTime;
  const deltaTime = frameIntervalMs / 1000;
  prevTime = now;
  update(deltaTime);
  draw();
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
  } else if (panning) {
    camPos.x -= dx / PAN_SENSITIVITY;
    camPos.y += dy / PAN_SENSITIVITY;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  const scale = Math.tan((FOV * 0.5 * Math.PI) / 180);
  orthoSize += (e.deltaY * scale) / ZOOM_SENSITIVITY;
  camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
};

canvas.oncontextmenu = (e) => e.preventDefault();

window.addEventListener("keydown", (event) => {
  if (modelDd.value !== "nyxy" && event.key.toLowerCase() === "n") {
    modelDd.value = "nyxy";
    modelDd.dispatchEvent(new Event("change"));
  }
});

modelDd.onchange = () => {
  setModel(modelDd.value as ModelKey);
};

loadGlbBtn.addEventListener("click", () => {
  glbInput.click();
});

glbInput.addEventListener("change", () => {
  const [file] = glbInput.files ?? [];
  glbInput.value = "";
  if (!file) {
    return;
  }

  loadSelectedGlb(file).catch((error) => {
    console.error(`Failed to load GLB file "${file.name}"`, error);
  });
});

updateModelStats();
loop();
