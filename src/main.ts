import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { DepthTexture, Framebuffer, edgeFunction, line, triangle } from "./drawing";
import { facesAway, getModelRadius } from "./utils/mesh";
import { ensureModelUrlOption, type ModelOption } from "./utils/modelLoader";
import {
  buildEnvironmentIbl,
  estimateEnvironmentYaw,
  rebuildEnvironmentBackdrop,
} from "./shaders/shaderHelpers";
import { createShaders } from "./shaders";
import { BaseShader } from "./shaders/BaseShader";
import {
  SHADING_PRESETS,
  type RenderSelection,
  resolveShadingSelection,
  type RenderMode,
} from "./renderSettings";
import { loadHdrTexture } from "./utils/hdrLoader";
import { TiledWorkerRenderer, type FrameTransforms } from "./workers/TiledWorkerRenderer";

const FOV = 50;
const INITIAL_CAMERA_Z = -3;
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
const DEFAULT_MODEL_URL = DEFAULT_RENDER_SELECTION.model;

if (!DEFAULT_MODEL_URL) {
  throw new Error("The default shading preset must define a model.");
}

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const frameTimeText = document.getElementById("frameTime") as HTMLSpanElement;
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
const shadingButtons = [...shadingList.querySelectorAll<HTMLButtonElement>(".shading-option")];

const getPresetIndex = () => {
  const maxShadingIndex = Math.max(0, SHADING_PRESETS.length - 1);
  return maxShadingIndex - Number(shadingSlider.value);
};

const setActive = (button: HTMLButtonElement, isActive: boolean) => {
  button.classList.toggle("is-active", isActive);
  button.setAttribute("aria-pressed", String(isActive));
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
  for (const button of shadingButtons) {
    setActive(button, button.dataset.shadingIndex === shadingSlider.value);
  }
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
const shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
const shadowBuffer = new Framebuffer(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
// Sized by setRenderResolution()
let frameBuffer: Framebuffer;
let depthBuffer: DepthTexture;
let bgBuffer: Framebuffer;
// Frames are drawn by the multithreaded renderer (src/workers). It shares memory between workers,
// which browsers only allow on cross-origin isolated pages (see public/coi-serviceworker.js), so
// without that draw() renders them on the main thread instead.
const workerRenderer = crossOriginIsolated ? new TiledWorkerRenderer() : undefined;

const setRenderResolution = (resolutionHeight: number) => {
  const height = resolutionHeight;
  const width = Math.round(height * RENDER_ASPECT_RATIO);

  frameBuffer = new Framebuffer(width, height);
  depthBuffer = new DepthTexture(width, height);
  bgBuffer = new Framebuffer(width, height);
  fitCanvas();
};

const applyRenderResolution = (resolution?: number) => {
  setRenderResolution(resolution ?? DEFAULT_RESOLUTION_HEIGHT);
};

applyRenderResolution(DEFAULT_RENDER_SELECTION.resolution);
window.addEventListener("resize", fitCanvas);

// The first model downloads while the environment's lighting is built
const initialModelRequest = ensureModelUrlOption(DEFAULT_MODEL_URL);
const hdrEnvironment = await loadHdrTexture(`${import.meta.env.BASE_URL}environments/sunny.hdr`);

// Scene and camera
const lightDir = new Vector3(1, -1, 1).scale(-1).normalize();
const camPos = new Vector3(0, 0, INITIAL_CAMERA_Z);

// Derived scene data
const cameraLookDir = Vector3.Forward;
const envYaw = estimateEnvironmentYaw(hdrEnvironment, lightDir);
const iblData = buildEnvironmentIbl(hdrEnvironment);
const rebuildBackdrop = () => {
  rebuildEnvironmentBackdrop(bgBuffer, iblData, RENDER_ASPECT_RATIO, FOV, envYaw);
};
rebuildBackdrop();

const initialModelOption = await initialModelRequest;

let model = initialModelOption.mesh;
let material = initialModelOption.material;
let shadowOrthoSize = getModelRadius(model);
const modelPos = new Vector3(0, 0, 0);
const modelRotation = new Vector3(0, Math.PI / 2, 0);
const modelScale = Vector3.One.scaleInPlace(1.15);

const shaders = createShaders();

const triVerts: Vector4[] = [];
let activeRenderSettings = DEFAULT_RENDER_SELECTION;

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toLocaleString();
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
  // Only presets that show the environment need its backdrop, which is slow to build at high res
  if (selection.showEnvironmentBackground) {
    rebuildBackdrop();
  }
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
  viewpoint: Vector4,
  renderMode: RenderMode = "filled",
  targetBuffer: Framebuffer = frameBuffer,
  perspectiveCorrect: boolean = true,
  snapVertices: boolean = false,
  pixelFn = targetBuffer.setPixel,
) => {
  // Snapping can turn a nearly edge-on back face towards the camera, and triangle() draws those
  const skipBackFaces = renderMode === "filled" && !snapVertices;
  for (let i = 0; i < model.vertices.length; i += 3) {
    if (skipBackFaces && facesAway(model, i, viewpoint)) continue;

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
      if (renderMode === "depthWireframe") {
        if (edgeFunction(triVerts[0], triVerts[1], triVerts[2]) <= 0) continue;
      }

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

const buildTransforms = (): FrameTransforms => {
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
  const projMat = Matrix4.Perspective(FOV, RENDER_ASPECT_RATIO);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

  const modelCamera = invModelMat.transformPoint(camPos).extend(1);
  const modelLight = invModelMat.transformDirection(lightDir).extend(0);

  return { modelMat, normalMat, worldLightSpaceMat, mvp, modelCamera, modelLight };
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

  // 2-4) Build the model, light and camera transforms.
  const { modelMat, normalMat, worldLightSpaceMat, mvp, modelCamera, modelLight } =
    buildTransforms();
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
    material,
    iblData,
    worldLightSpaceMat,
    shadowMap,
    receiveShadows: useShadows,
    useSpecular: renderSettings.useSpecular,
    disableTexture: renderSettings.disableTexture,
    textureFiltering: renderSettings.textureFiltering,
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

  const pixelFn = frameBuffer[renderSettings.setPixelFn ?? "setPixel"];

  // 6) Main render pass
  renderMesh(
    shader,
    depthBuffer,
    modelCamera,
    renderSettings.renderMode,
    frameBuffer,
    perspectiveCorrect,
    snapVertices,
    pixelFn,
  );
  present(frameBuffer);
};

// The same frame as draw(), split across Web Workers by src/workers
const drawWithWorkers = async (renderer: TiledWorkerRenderer, dt: number) => {
  // A preset change can swap the framebuffer while the workers draw, so present the one they drew
  const targetBuffer = frameBuffer;
  await renderer.draw({
    settings: activeRenderSettings,
    dt,
    model,
    material,
    iblData,
    envYaw,
    lightDir,
    camPos,
    transforms: buildTransforms(),
    frameBuffer: targetBuffer,
    background: bgBuffer,
    shadowMapSize: SHADOW_MAP_SIZE,
  });
  present(targetBuffer);
};

// Resizing the canvas clears it, so it waits until a frame of the new size is ready. Otherwise a
// preset change made while the workers draw would leave the canvas blank until their next frame.
const present = (buffer: Framebuffer) => {
  if (canvas.width !== buffer.width || canvas.height !== buffer.height) {
    canvas.width = buffer.width;
    canvas.height = buffer.height;
  }
  ctx.putImageData(buffer.imageData, 0, 0);
};

let prevTime = performance.now();
let lastFpsUiUpdate = prevTime;
const loop = async () => {
  // Ask for the next vsync up front, so a frame that overruns one starts the next straight away
  const nextDisplayFrame = new Promise((resolve) => requestAnimationFrame(resolve));
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  prevTime = now;
  update();
  if (workerRenderer) {
    await drawWithWorkers(workerRenderer, dt);
  } else {
    draw(dt);
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

window.addEventListener("keydown", (event) => {
  if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    if (event.key === "ArrowUp") {
      shadingSlider.stepUp();
    } else {
      shadingSlider.stepDown();
    }
    syncShadingButtons();
    applyCurrentShadingSelection();
    event.preventDefault();
  }
});

updateModelStats();
loop();
