import "./style.css";
import { Vector3 } from "./maths";
import { DepthTexture, Framebuffer } from "./drawing";
import {
  buildTileTriangleBins,
  createShaders,
  renderShadowPass,
  type FrameRenderState,
  type RenderSettings,
  type StaticRenderScene,
} from "./renderer/renderCore";
import { RenderSelection, resolveShadingSelection } from "./renderSettings";
import {
  buildEnvironmentIbl,
  estimateEnvironmentYaw,
  rebuildEnvironmentBackdrop,
} from "./shaders/iblHelpers";
import { loadHdrTexture } from "./utils/hdrLoader";
import {
  type ModelKey,
  type ModelOption,
  ensureModelOption,
  loadCustomGlb,
  prefetchRemainingModels,
} from "./utils/modelLoader";
import { getModelRadius } from "./utils/mesh";
import { TiledWorkerRenderer } from "./workers/TiledWorkerRenderer";

const CANVAS_WIDTH = 1280;
const CANVAS_HEIGHT = 800;
const FOV = 50;
const SHADOW_MAP_SIZE = 512;
const INITIAL_ROTATION = Math.PI / 2;
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
const localShaders = createShaders();
const workerRenderer = new TiledWorkerRenderer();

let mouseButtonState = 0;
let lastRenderedFrameMs = 0;

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
let frameBuffer = new Framebuffer(CANVAS_WIDTH, CANVAS_HEIGHT);
let shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowBuffer = new Framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let bgBuffer = new Framebuffer(CANVAS_WIDTH, CANVAS_HEIGHT);
let bgBufferTonemapped = new Framebuffer(CANVAS_WIDTH, CANVAS_HEIGHT);

const setRenderResolution = () => {
  const width = CANVAS_WIDTH;
  const height = CANVAS_HEIGHT;
  const shadowMapSize = SHADOW_MAP_SIZE;

  canvas.width = width;
  canvas.height = height;
  aspectRatio = width / height;
  frameBuffer = new Framebuffer(width, height);
  shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
  shadowBuffer = new Framebuffer(shadowMapSize, shadowMapSize);
  bgBuffer = new Framebuffer(width, height);
  bgBufferTonemapped = new Framebuffer(width, height);
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
const viewDir = Vector3.Forward.scale(-1);
const envYaw = estimateEnvironmentYaw(hdrEnvironment, lightDir);
const iblData = buildEnvironmentIbl(hdrEnvironment);
rebuildEnvironmentBackdrop(bgBuffer, iblData, aspectRatio, FOV, envYaw, false);
rebuildEnvironmentBackdrop(bgBufferTonemapped, iblData, aspectRatio, FOV, envYaw, true);

const initialModelOption = await ensureModelOption(INITIAL_MODEL);
modelDd.value = INITIAL_MODEL;
prefetchRemainingModels(INITIAL_MODEL);

let model = initialModelOption.mesh;
let material = initialModelOption.material;
let shadowOrthoSize = getModelRadius(model);

let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, INITIAL_ROTATION, 0);
let modelScale = new Vector3(1, 1, 1);
let activeModelRequest = 0;

type UiRenderSettings = Omit<RenderSelection, "normalizedValue">;

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  resolutionText.innerText = `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`;
};

const resetModelTransform = () => {
  modelRotation.set(0, INITIAL_ROTATION, 0);
  camPos.set(0, 0, -3);
  orthoSize = -camPos.z * Math.tan((FOV * Math.PI) / 180 / 2);
};

const getRenderSettings = (): UiRenderSettings => {
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
    tonemap: selection.tonemap,
  };
};

const buildStaticScene = (): StaticRenderScene => {
  return {
    model,
    material,
    iblData,
    lightDir,
    envYaw,
    shadowOrthoSize,
  };
};

const buildFrameState = (renderSettings: RenderSettings): FrameRenderState => {
  return {
    modelPos,
    modelRotation,
    modelScale,
    camPos,
    viewDir,
    aspectRatio,
    orthoSize,
    isOrtho: orthoCb.checked,
    renderSettings,
  };
};

const syncWorkersScene = () => {
  workerRenderer.configure(
    buildStaticScene(),
    frameBuffer.imageData,
    shadowMap.width,
    FOV,
    bgBuffer.imageData.data,
    bgBufferTonemapped.imageData.data,
  );
};

const renderWithWorkers = async (renderSettings: RenderSettings) => {
  const scene = buildStaticScene();
  const frame = buildFrameState(renderSettings);
  const tileTriangleVertexIndices = buildTileTriangleBins(
    scene,
    frame,
    FOV,
    frameBuffer.imageData.width,
    frameBuffer.imageData.height,
    workerRenderer.tiles,
  );

  let sharedShadowMapData;
  if (renderSettings.useShadows) {
    sharedShadowMapData = shadowMap.data;
    renderShadowPass(scene, frame, shadowMap, shadowBuffer, localShaders, FOV);
  }

  const targetImage = frameBuffer.imageData;
  const elapsedMs = await workerRenderer.render(
    frame,
    targetImage,
    tileTriangleVertexIndices,
    sharedShadowMapData,
  );
  lastRenderedFrameMs = elapsedMs;
  ctx.putImageData(targetImage, 0, 0);
};

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

  syncWorkersScene();
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

  syncWorkersScene();
};

const update = (dt: number) => {
  if (mouseButtonState !== 1) {
    modelRotation.y -= dt * ROTATION_SPEED;
  }
};

let prevTime = performance.now();
let lastFpsUiUpdate = prevTime;
const loop = async () => {
  const now = performance.now();
  const frameIntervalMs = now - prevTime;
  const deltaTime = frameIntervalMs / 1000;
  prevTime = now;

  update(deltaTime);
  const renderSettings = getRenderSettings();

  await renderWithWorkers(renderSettings);

  if (now - lastFpsUiUpdate >= FPS_UPDATE_INTERVAL_MS) {
    const fps = 1000 / lastRenderedFrameMs;
    fpsText.innerText = `${lastRenderedFrameMs.toFixed(0)} ms (${fps.toFixed(0)} fps)`;
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
  void setModel(modelDd.value as ModelKey);
};

loadGlbBtn.addEventListener("click", () => {
  glbInput.click();
});

glbInput.addEventListener("change", async () => {
  const [file] = glbInput.files ?? [];
  glbInput.value = "";
  if (!file) {
    return;
  }

  try {
    await loadSelectedGlb(file);
  } catch (error) {
    console.error(`Failed to load GLB file "${file.name}"`, error);
  }
});

updateModelStats();
syncWorkersScene();
loop();
