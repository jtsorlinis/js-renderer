import "./style.css";
import { Vector3 } from "./maths";
import { DepthTexture, Framebuffer } from "./drawing";
import {
  buildTileTriangleBins,
  createShaders,
  drawScene,
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
  setHighResTextureLimits,
} from "./utils/modelLoader";
import { getModelRadius } from "./utils/mesh";
import { TiledWorkerRenderer } from "./workers/TiledWorkerRenderer";

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
const MAX_RENDER_WORKERS = 4;

const WORKER_COUNT = (() => {
  const cores = navigator.hardwareConcurrency ?? MAX_RENDER_WORKERS;
  return cores > 1 ? Math.min(MAX_RENDER_WORKERS, cores) : 1;
})();

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const orthoCb = document.getElementById("orthoCb") as HTMLInputElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const textureSizeText = document.getElementById("textureSize") as HTMLSpanElement;
const highResCb = document.getElementById("highResCb") as HTMLInputElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingSlider = document.getElementById("shadingSlider") as HTMLInputElement;
const modelDd = document.getElementById("modelDd") as HTMLSelectElement;
const loadGlbBtn = document.getElementById("loadGlbBtn") as HTMLButtonElement;
const glbInput = document.getElementById("glbInput") as HTMLInputElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
const localShaders = createShaders();
const workerRenderer = WORKER_COUNT > 1 ? new TiledWorkerRenderer(WORKER_COUNT) : null;

let mouseButtonState = 0;
let workersDisabled = false;
let workerSyncPending = false;
let workerSyncQueue = Promise.resolve();
let workerFramePromise: Promise<void> | null = null;
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

let imageData = new ImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
let frameBuffer = new Framebuffer(imageData);
let depthBuffer = new DepthTexture(CANVAS_WIDTH, CANVAS_HEIGHT);
let shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowBuffer = new Framebuffer({ width: SHADOW_MAP_SIZE, height: SHADOW_MAP_SIZE });
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
  shadowBuffer = new Framebuffer({ width: shadowMapSize, height: shadowMapSize });
  bgImageData = new ImageData(width, height);
  bgBuffer = new Framebuffer(bgImageData);
  fitCanvas();
};

setRenderResolution();
window.addEventListener("resize", fitCanvas);
setHighResTextureLimits(highResCb.checked);

const hdrEnvironment = await loadHdrTexture(`${import.meta.env.BASE_URL}environments/sunny.hdr`);

// Scene and camera
const lightDir = new Vector3(1, -1, 1).normalize();
const lightCol = new Vector3(1, 1, 1);
const camPos = new Vector3(0, 0, -3);
let orthoSize = -camPos.z * Math.tan((FOV * Math.PI) / 180 / 2);

// Derived scene data
const viewDir = Vector3.Forward.scale(-1);
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
let customGlbFile: File | null = null;
let activeModelRequest = 0;

type UiRenderSettings = Omit<RenderSelection, "normalizedValue">;

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  textureSizeText.innerText = `${Math.max(
    material.colorTexture.width,
    material.colorTexture.height,
  )}`;
};

const resetModelTransform = () => {
  modelRotation.set(0, Math.PI / 2, 0);
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
  };
};

const buildStaticScene = (): StaticRenderScene => {
  return {
    model,
    material,
    iblData,
    lightDir,
    lightCol,
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

const renderLocally = (renderSettings: RenderSettings) => {
  drawScene(
    buildStaticScene(),
    buildFrameState(renderSettings),
    {
      frameBuffer,
      depthBuffer,
      shadowMap,
      shadowBuffer,
      backgroundBuffer: bgBuffer,
    },
    localShaders,
    FOV,
  );
  ctx.putImageData(imageData, 0, 0);
};

const disableWorkers = (reason: string, error: unknown) => {
  workersDisabled = true;
  workerFramePromise = null;
  workerSyncPending = false;
  workerRenderer?.dispose();
  console.error(reason, error);
};

const syncWorkersScene = () => {
  if (!workerRenderer || workersDisabled) {
    return Promise.resolve();
  }

  workerSyncPending = true;
  const queuedSync = workerSyncQueue
    .catch(() => undefined)
    .then(async () => {
      await workerRenderer.configure(
        buildStaticScene(),
        imageData,
        shadowMap.width,
        FOV,
        bgBuffer.data,
      );
    })
    .catch((error) => {
      disableWorkers("Failed to configure render workers", error);
    })
    .finally(() => {
      if (workerSyncQueue === queuedSync) {
        workerSyncPending = false;
      }
    });

  workerSyncQueue = queuedSync;
  return queuedSync;
};

const renderWithWorkers = (renderSettings: RenderSettings) => {
  if (!workerRenderer || workersDisabled || workerSyncPending || !workerRenderer.isConfigured) {
    return false;
  }

  if (workerFramePromise) {
    return true;
  }

  const scene = buildStaticScene();
  const frame = buildFrameState(renderSettings);
  const tileTriangleVertexIndices = buildTileTriangleBins(
    scene,
    frame,
    FOV,
    imageData.width,
    imageData.height,
    workerRenderer.tiles,
  );
  const sharedShadowMapData = renderSettings.useShadows ? shadowMap.data : undefined;
  if (renderSettings.useShadows) {
    renderShadowPass(scene, frame, shadowMap, shadowBuffer, localShaders, FOV);
  }
  const targetImage = imageData;
  workerFramePromise = workerRenderer
    .render(frame, targetImage, tileTriangleVertexIndices, sharedShadowMapData)
    .then((elapsedMs) => {
      if (targetImage !== imageData) {
        return;
      }
      lastRenderedFrameMs = elapsedMs;
      ctx.putImageData(targetImage, 0, 0);
    })
    .catch((error) => {
      disableWorkers("Render workers failed during frame rendering", error);
      if (targetImage === imageData) {
        const localStart = performance.now();
        renderLocally(renderSettings);
        lastRenderedFrameMs = performance.now() - localStart;
      }
    })
    .finally(() => {
      workerFramePromise = null;
    });

  return true;
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

  customGlbFile = null;
  applyModelOption(selectedModel);
  if (resetTransform) {
    resetModelTransform();
  }

  await syncWorkersScene();
};

const loadSelectedGlb = async (file: File, resetTransform = true) => {
  const requestId = ++activeModelRequest;
  const selectedModel = await loadCustomGlb(file);
  if (requestId !== activeModelRequest) {
    return;
  }

  customGlbFile = file;
  applyModelOption(selectedModel);
  if (resetTransform) {
    resetModelTransform();
  }

  await syncWorkersScene();
};

highResCb.addEventListener("change", () => {
  setRenderResolution(highResCb.checked ? 2 : 1);
  rebuildEnvironmentBackdrop(bgBuffer, iblData, aspectRatio, FOV, envYaw);
  void syncWorkersScene();
  if (!setHighResTextureLimits(highResCb.checked)) return;
  if (customGlbFile) {
    void loadSelectedGlb(customGlbFile, false);
    return;
  }
  void setModel(modelDd.value as ModelKey, false);
});

const update = (dt: number) => {
  if (mouseButtonState !== 1) {
    modelRotation.y -= dt * ROTATION_SPEED;
  }
};

let prevTime = performance.now();
let lastFpsUiUpdate = prevTime;
const loop = () => {
  const now = performance.now();
  const frameIntervalMs = now - prevTime;
  const deltaTime = frameIntervalMs / 1000;
  prevTime = now;

  update(deltaTime);
  const renderSettings = getRenderSettings();

  if (!renderWithWorkers(renderSettings)) {
    const localStart = performance.now();
    renderLocally(renderSettings);
    lastRenderedFrameMs = performance.now() - localStart;
  }

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

glbInput.addEventListener("change", () => {
  const [file] = glbInput.files ?? [];
  glbInput.value = "";
  if (!file) {
    return;
  }

  void loadSelectedGlb(file).catch((error) => {
    console.error(`Failed to load GLB file "${file.name}"`, error);
  });
});

window.addEventListener("pagehide", () => {
  workerRenderer?.dispose();
});

updateModelStats();
await syncWorkersScene();
loop();
