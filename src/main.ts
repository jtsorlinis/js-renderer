import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { DepthTexture, Framebuffer, edgeFunction, line, triangle } from "./drawing";
import { facesAway, getModelRadius } from "./utils/mesh";
import {
  ensureModelOption,
  loadCustomGlb,
  prefetchRemainingModels,
  type ModelKey,
  type ModelOption,
} from "./utils/modelLoader";
import {
  buildEnvironmentIbl,
  estimateEnvironmentYaw,
  rebuildEnvironmentBackdrop,
} from "./shaders/shaderHelpers";
import { createShaders } from "./shaders";
import { BaseShader } from "./shaders/BaseShader";
import { resolveShadingSelection, type RenderMode } from "./renderSettings";
import { loadHdrTexture } from "./utils/hdrLoader";
import { TiledWorkerRenderer, type FrameTransforms } from "./workers/TiledWorkerRenderer";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
// The multithreaded renderer draws at double resolution, so the aspect ratio is the same
const ASPECT_RATIO = CANVAS_WIDTH / CANVAS_HEIGHT;
const FOV = 50;
const TAN_HALF_FOV = Math.tan((FOV * Math.PI) / 360);
const INITIAL_CAMERA_Z = -3;
const DEFAULT_ORTHO_SIZE = -INITIAL_CAMERA_Z * TAN_HALF_FOV;
const SHADOW_MAP_SIZE = 512;
const INITIAL_ROTATION = Math.PI / 3;
const ROTATION_SPEED = 0.2;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;
const FPS_UPDATE_INTERVAL_MS = 250;
const INITIAL_MODEL: ModelKey = "dice";

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const frameTimeText = document.getElementById("frameTime") as HTMLSpanElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const orthoCb = document.getElementById("orthoCb") as HTMLInputElement;
const workersCb = document.getElementById("workersCb") as HTMLInputElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingButtons = [...shadingList.querySelectorAll<HTMLButtonElement>(".shading-option")];
const shadingSlider = document.getElementById("shadingSlider") as HTMLInputElement;
const modelGrid = document.getElementById("modelGrid") as HTMLDivElement;
const modelTiles = [...modelGrid.querySelectorAll<HTMLButtonElement>(".model-tile")];
const loadGlbBtn = document.getElementById("loadGlbBtn") as HTMLButtonElement;
const glbInput = document.getElementById("glbInput") as HTMLInputElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
let mouseButtonState = 0;

const setActive = (button: HTMLButtonElement, isActive: boolean) => {
  button.classList.toggle("is-active", isActive);
  button.setAttribute("aria-pressed", String(isActive));
};

const getShadingButton = () => {
  return shadingButtons.find((button) => button.dataset.shadingIndex === shadingSlider.value);
};

const syncShadingButtons = () => {
  for (const button of shadingButtons) {
    setActive(button, button.dataset.shadingIndex === shadingSlider.value);
  }
};

syncShadingButtons();

shadingList.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  const button = target.closest(".shading-option") as HTMLButtonElement;
  shadingSlider.value = button?.dataset.shadingIndex || shadingSlider.value;
  syncShadingButtons();
});

shadingSlider.addEventListener("input", syncShadingButtons);

// The model whose tile is highlighted; undefined while a loaded GLB is shown
let selectedModel: ModelKey | undefined;

const selectModelTile = (modelKey: ModelKey | undefined) => {
  selectedModel = modelKey;
  for (const tile of modelTiles) {
    setActive(tile, tile.dataset.model === modelKey);
  }
};

const viewport = canvas.parentElement!;
const fitCanvas = () => {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  let w = vw;
  let h = w / ASPECT_RATIO;
  if (h > vh) {
    h = vh;
    w = h * ASPECT_RATIO;
  }
  canvas.style.width = `${Math.floor(w)}px`;
  canvas.style.height = `${Math.floor(h)}px`;
};
const shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
const shadowBuffer = new Framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
// Sized by setRenderResolution()
let frameBuffer: Framebuffer;
let depthBuffer: DepthTexture;
let bgBuffer: Framebuffer;
let bgBufferTonemapped: Framebuffer;
// Set while the multithreaded renderer (src/workers) is in use
let workerRenderer: TiledWorkerRenderer | undefined;

// The multithreaded renderer shares memory between workers, which browsers only allow on
// cross-origin isolated pages (see public/coi-serviceworker.js)
if (!crossOriginIsolated) {
  workersCb.checked = false;
  workersCb.disabled = true;
}

const selectRenderer = () => {
  workerRenderer?.dispose();
  workerRenderer = workersCb.checked ? new TiledWorkerRenderer() : undefined;
};
selectRenderer();

const setRenderResolution = () => {
  // The multithreaded renderer draws at double resolution
  const scale = workerRenderer ? 2 : 1;
  const width = CANVAS_WIDTH * scale;
  const height = CANVAS_HEIGHT * scale;

  canvas.width = width;
  canvas.height = height;
  frameBuffer = new Framebuffer(width, height);
  depthBuffer = new DepthTexture(width, height);
  bgBuffer = new Framebuffer(width, height);
  bgBufferTonemapped = new Framebuffer(width, height);
  fitCanvas();
};

setRenderResolution();
window.addEventListener("resize", fitCanvas);

// The first model downloads while the environment's lighting is built
const initialModelRequest = ensureModelOption(INITIAL_MODEL);
const hdrEnvironment = await loadHdrTexture(`${import.meta.env.BASE_URL}environments/sunny.hdr`);

// Scene and camera
const lightDir = new Vector3(1, -1, 1).scale(-1).normalize();
const camPos = new Vector3(0, 0, INITIAL_CAMERA_Z);
let orthoSize = DEFAULT_ORTHO_SIZE;

// Derived scene data
const cameraLookDir = Vector3.Forward;
const viewDir = cameraLookDir.scale(-1);
const envYaw = estimateEnvironmentYaw(hdrEnvironment, lightDir);
const iblData = buildEnvironmentIbl(hdrEnvironment);
const rebuildBackdrops = () => {
  rebuildEnvironmentBackdrop(bgBuffer, iblData, ASPECT_RATIO, FOV, envYaw, bgBufferTonemapped);
};
rebuildBackdrops();

const initialModelOption = await initialModelRequest;
selectModelTile(INITIAL_MODEL);
prefetchRemainingModels(INITIAL_MODEL);

let model = initialModelOption.mesh;
let material = initialModelOption.material;
let shadowOrthoSize = getModelRadius(model);

const modelPos = new Vector3(0, 0, 0);
const modelRotation = new Vector3(0, INITIAL_ROTATION, 0);
const modelScale = new Vector3(1, 1, 1);
let rotationPaused = false;

const shaders = createShaders();

const triVerts: Vector4[] = [];

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toLocaleString();
};

const resetModelTransform = () => {
  modelRotation.set(0, INITIAL_ROTATION, 0);
  camPos.set(0, 0, INITIAL_CAMERA_Z);
  orthoSize = DEFAULT_ORTHO_SIZE;
};

let activeModelRequest = 0;
// The model being drawn; undefined while a loaded GLB is shown
let shownModel: ModelKey | undefined = INITIAL_MODEL;

const applyModelOption = (option: ModelOption) => {
  model = option.mesh;
  material = option.material;
  shadowOrthoSize = getModelRadius(model);
  updateModelStats();
};

const loadAndApplyModel = async (
  modelKey: ModelKey | undefined,
  loadModel: () => Promise<ModelOption>,
) => {
  const requestId = ++activeModelRequest;
  selectModelTile(modelKey);
  try {
    const option = await loadModel();
    if (requestId !== activeModelRequest) {
      return;
    }

    shownModel = modelKey;
    applyModelOption(option);
    resetModelTransform();
  } catch (error) {
    if (requestId === activeModelRequest) {
      selectModelTile(shownModel);
    }
    throw error;
  }
};

const setModel = (modelKey: ModelKey) => {
  loadAndApplyModel(modelKey, () => ensureModelOption(modelKey)).catch((error) => {
    console.error(`Failed to load model "${modelKey}"`, error);
  });
};

const loadSelectedGlb = (file: File) => {
  return loadAndApplyModel(undefined, () => loadCustomGlb(file));
};

const getRenderSettings = () => {
  return resolveShadingSelection(getShadingButton()?.dataset.shadingValue ?? "wireframe");
};

const renderMesh = (
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  viewpoint: Vector4,
  renderMode: RenderMode = "filled",
  targetBuffer: Framebuffer = frameBuffer,
  tonemap?: boolean,
) => {
  const skipBackFaces = renderMode === "filled";
  for (let i = 0; i < model.vertices.length; i += 3) {
    if (skipBackFaces && facesAway(model, i, viewpoint)) continue;

    // Vertex stage for one triangle.
    for (let j = 0; j < 3; j++) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex().perspectiveDivide();
    }

    if (renderMode !== "filled") {
      if (renderMode === "depthWireframe") {
        if (edgeFunction(triVerts[0], triVerts[1], triVerts[2]) <= 0) continue;
      }

      line(triVerts[0], triVerts[1], targetBuffer, depthBuffer);
      line(triVerts[1], triVerts[2], targetBuffer, depthBuffer);
      line(triVerts[2], triVerts[0], targetBuffer, depthBuffer);
      continue;
    }

    // Rasterization + fragment stage.
    triangle(triVerts, activeShader, targetBuffer, depthBuffer, tonemap);
  }
};

const update = (dt: number) => {
  if (!rotationPaused && mouseButtonState !== 1) {
    modelRotation.y -= dt * ROTATION_SPEED;
  }
};

const buildTransforms = (isOrtho: boolean): FrameTransforms => {
  // 2) Build model and world-space transforms.
  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = invModelMat.transpose();

  // 3) Build light-space transform (for shadow mapping).
  const lightViewMat = Matrix4.LookAt(lightDir.scale(5), Vector3.Zero);
  const lightProjMat = Matrix4.Ortho(shadowOrthoSize, 1, 1, 10);
  const worldLightSpaceMat = lightProjMat.multiply(lightViewMat);

  // 4) Build camera transform and final clip transform.
  const viewMat = Matrix4.LookTo(camPos, cameraLookDir, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(orthoSize, ASPECT_RATIO)
    : Matrix4.Perspective(FOV, ASPECT_RATIO);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

  const modelCamera = isOrtho
    ? invModelMat.transformDirection(viewDir).extend(0)
    : invModelMat.transformPoint(camPos).extend(1);
  const modelLight = invModelMat.transformDirection(lightDir).extend(0);

  return { modelMat, normalMat, worldLightSpaceMat, mvp, modelCamera, modelLight };
};

const draw = () => {
  const renderSettings = getRenderSettings();

  // 1) Clear all render targets for a new frame.
  if (renderSettings.showEnvironmentBackground) {
    frameBuffer.copyFrom(renderSettings.tonemap ? bgBufferTonemapped : bgBuffer);
  } else {
    frameBuffer.clear();
  }
  depthBuffer.clear(1000);

  // 2-4) Build the model, light and camera transforms.
  const isOrtho = orthoCb.checked;
  const { modelMat, normalMat, worldLightSpaceMat, mvp, modelCamera, modelLight } =
    buildTransforms(isOrtho);
  const useShadows = renderSettings.useShadows === true;

  // 5) Select active material shader and update uniforms.
  const shader = shaders[renderSettings.material];

  shader.uniforms = {
    model,
    modelMat,
    mvp,
    normalMat,
    worldLightDir: lightDir,
    envYaw,
    worldCamPos: camPos,
    orthographic: isOrtho,
    worldViewDir: viewDir,
    material,
    iblData,
    worldLightSpaceMat,
    shadowMap,
    receiveShadows: useShadows,
  };

  // Optional shadow pass first
  if (useShadows) {
    shadowMap.clear(1000);
    shaders.depth.uniforms = { model, clipMat: worldLightSpaceMat.multiply(modelMat) };
    renderMesh(shaders.depth, shadowMap, modelLight, "filled", shadowBuffer);
  }
  // The camera's depth shader, for the wireframe modes and their depth prepass
  shaders.depth.uniforms = { model, clipMat: mvp };

  // We need a depth prepass for wireframe culling
  if (renderSettings.renderMode === "depthWireframe") {
    renderMesh(shaders.depth, depthBuffer, modelCamera);
  }

  // 6) Main render pass
  const { renderMode, tonemap } = renderSettings;
  renderMesh(shader, depthBuffer, modelCamera, renderMode, frameBuffer, tonemap);
  ctx.putImageData(frameBuffer.imageData, 0, 0);
};

// The same frame as draw(), split across Web Workers by src/workers
const drawWithWorkers = async (renderer: TiledWorkerRenderer) => {
  const isOrtho = orthoCb.checked;
  await renderer.draw({
    settings: getRenderSettings(),
    model,
    material,
    iblData,
    envYaw,
    lightDir,
    camPos,
    viewDir,
    isOrtho,
    transforms: buildTransforms(isOrtho),
    frameBuffer,
    background: bgBuffer,
    backgroundTonemapped: bgBufferTonemapped,
    shadowMapSize: SHADOW_MAP_SIZE,
  });
  ctx.putImageData(frameBuffer.imageData, 0, 0);
};

// Switches between draw() and drawWithWorkers()
const toggleWorkers = () => {
  selectRenderer();
  setRenderResolution();
  rebuildBackdrops();
};

let prevTime = performance.now();
let lastFpsUiUpdate = prevTime;
const loop = async () => {
  // Ask for the next vsync up front, so a frame that overruns one starts the next straight away
  const nextDisplayFrame = new Promise((resolve) => requestAnimationFrame(resolve));
  // Switch renderers between frames, never while the workers are drawing one
  if (workersCb.checked !== (workerRenderer !== undefined)) {
    toggleWorkers();
  }
  const now = performance.now();
  const frameIntervalMs = now - prevTime;
  const deltaTime = frameIntervalMs / 1000;
  prevTime = now;
  update(deltaTime);
  if (workerRenderer) {
    await drawWithWorkers(workerRenderer);
  } else {
    draw();
  }
  const actualFrameTime = performance.now() - now;

  if (now - lastFpsUiUpdate >= FPS_UPDATE_INTERVAL_MS) {
    const fps = 1000 / actualFrameTime;
    frameTimeText.innerText = actualFrameTime.toFixed(0);
    fpsText.innerText = fps.toFixed(0);
    lastFpsUiUpdate = now;
  }

  await nextDisplayFrame;
  loop();
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
  const dx = Number.isNaN(prevX) ? 0 : e.clientX - prevX;
  const dy = Number.isNaN(prevY) ? 0 : e.clientY - prevY;
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
  orthoSize += (e.deltaY * TAN_HALF_FOV) / ZOOM_SENSITIVITY;
  camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
};

canvas.oncontextmenu = (e) => e.preventDefault();

window.addEventListener("keydown", (event) => {
  if (selectedModel !== "nyxy" && event.key.toLowerCase() === "n") {
    setModel("nyxy");
    return;
  }

  if (event.code === "Space") {
    if (!event.repeat) rotationPaused = !rotationPaused;
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const models = modelTiles.map((tile) => tile.dataset.model as ModelKey);
    const index = models.findIndex((model) => model === selectedModel);
    const nextIndex =
      (index + (event.key === "ArrowRight" ? 1 : -1) + models.length) % models.length;
    setModel(models[nextIndex]);
    event.preventDefault();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (event.key === "ArrowUp") {
      shadingSlider.stepUp();
    } else {
      shadingSlider.stepDown();
    }
    syncShadingButtons();
    event.preventDefault();
  }
});

modelGrid.addEventListener("click", (event) => {
  const tile = (event.target as HTMLElement).closest<HTMLButtonElement>(".model-tile");
  const modelKey = tile?.dataset.model as ModelKey | undefined;
  if (modelKey && modelKey !== selectedModel) {
    setModel(modelKey);
  }
});

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
