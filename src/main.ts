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
import { WebGpuRenderer, type WebGpuRenderParams } from "./webgpu/WebGpuRenderer";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const WEBGPU_CANVAS_WIDTH = 1600;
const WEBGPU_CANVAS_HEIGHT = 1200;
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
const gpuCanvas = document.getElementById("gpuCanvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const orthoCb = document.getElementById("orthoCb") as HTMLInputElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const resolutionText = document.getElementById("resolution") as HTMLSpanElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingSlider = document.getElementById("shadingSlider") as HTMLInputElement;
const modelDd = document.getElementById("modelDd") as HTMLSelectElement;
const gpuCb = document.getElementById("gpuCb") as HTMLInputElement;
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
const renderCanvases = [canvas, gpuCanvas];
const getRendererResolutionText = () => {
  return activeRenderer === "webgpu"
    ? `${WEBGPU_CANVAS_WIDTH} x ${WEBGPU_CANVAS_HEIGHT}`
    : `${CANVAS_WIDTH} x ${CANVAS_HEIGHT}`;
};
const fitCanvas = () => {
  const vw = viewport.clientWidth;
  const vh = viewport.clientHeight;
  let w = vw;
  let h = w / aspectRatio;
  if (h > vh) {
    h = vh;
    w = h * aspectRatio;
  }
  for (const renderCanvas of renderCanvases) {
    renderCanvas.style.width = `${Math.floor(w)}px`;
    renderCanvas.style.height = `${Math.floor(h)}px`;
  }
};
let frameBuffer = new Framebuffer(CANVAS_WIDTH, CANVAS_HEIGHT);
let depthBuffer = new DepthTexture(CANVAS_WIDTH, CANVAS_HEIGHT);
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
  gpuCanvas.width = WEBGPU_CANVAS_WIDTH;
  gpuCanvas.height = WEBGPU_CANVAS_HEIGHT;
  aspectRatio = width / height;
  frameBuffer = new Framebuffer(width, height);
  depthBuffer = new DepthTexture(width, height);
  shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
  shadowBuffer = new Framebuffer(shadowMapSize, shadowMapSize);
  bgBuffer = new Framebuffer(width, height);
  bgBufferTonemapped = new Framebuffer(width, height);
  fitCanvas();
};

setRenderResolution();
window.addEventListener("resize", fitCanvas);

type RenderBackend = "cpu" | "webgpu";

let preferredRenderer: RenderBackend = "cpu";
let activeRenderer: RenderBackend = "cpu";
let webGpuRenderer: WebGpuRenderer | undefined;

const setActiveRenderer = (renderer: RenderBackend) => {
  if (activeRenderer === renderer) {
    return;
  }

  activeRenderer = renderer;
  canvas.hidden = renderer !== "cpu";
  gpuCanvas.hidden = renderer !== "webgpu";
  resolutionText.innerText = getRendererResolutionText();
};

const initializeWebGpuRenderer = async () => {
  webGpuRenderer = await WebGpuRenderer.create(gpuCanvas);
  preferredRenderer = gpuCb.checked ? "webgpu" : "cpu";
  setActiveRenderer(preferredRenderer);
};

await initializeWebGpuRenderer();
const modelLoadOptions = {
  webGpuTextureMaxSize: webGpuRenderer?.maxTextureDimension2D,
};

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
rebuildEnvironmentBackdrop(bgBuffer, iblData, aspectRatio, FOV, envYaw, false);
rebuildEnvironmentBackdrop(bgBufferTonemapped, iblData, aspectRatio, FOV, envYaw, true);

const initialModelOption = await ensureModelOption(INITIAL_MODEL, modelLoadOptions);
modelDd.value = INITIAL_MODEL;
prefetchRemainingModels(INITIAL_MODEL);

let model = initialModelOption.mesh;
let material = initialModelOption.material;
let webGpuMaterial = initialModelOption.webGpuMaterial ?? initialModelOption.material;
let shadowOrthoSize = getModelRadius(model);

let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, INITIAL_ROTATION, 0);
let modelScale = new Vector3(1, 1, 1);
let rotationPaused = false;

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
type FrameState = {
  renderSettings: RenderSettings;
  modelMat: Matrix4;
  normalMat: Matrix4;
  worldLightSpaceMat: Matrix4;
  modelLightDir: Vector3;
  modelCamPos: Vector3;
  modelViewDir: Vector3;
  isOrtho: boolean;
  mvp: Matrix4;
};

const triVerts: Vector4[] = [];

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  resolutionText.innerText = getRendererResolutionText();
};

const resetModelTransform = () => {
  modelRotation.set(0, INITIAL_ROTATION, 0);
  camPos.set(0, 0, -3);
  orthoSize = -camPos.z * Math.tan((FOV * Math.PI) / 180 / 2);
};

let activeModelRequest = 0;

const applyModelOption = (selectedModel: ModelOption) => {
  model = selectedModel.mesh;
  material = selectedModel.material;
  webGpuMaterial = selectedModel.webGpuMaterial ?? selectedModel.material;
  shadowOrthoSize = getModelRadius(model);
  updateModelStats();
};

const setModel = async (modelKey: ModelKey, resetTransform = true) => {
  const requestId = ++activeModelRequest;
  const selectedModel = await ensureModelOption(modelKey, modelLoadOptions);
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
  const selectedModel = await loadCustomGlb(file, true, 1, modelLoadOptions);
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
    tonemap: selection.tonemap,
  };
};

const renderMesh = (
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  renderMode: RenderMode = "filled",
  targetBuffer: Framebuffer = frameBuffer,
  tonemap?: boolean,
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
    triangle(triVerts, activeShader, targetBuffer, depthBuffer, tonemap);
  }
};

const update = (dt: number) => {
  if (!rotationPaused && mouseButtonState !== 1) {
    modelRotation.y -= dt * ROTATION_SPEED;
  }
};

const getFrameState = (): FrameState => {
  const renderSettings = getRenderSettings();

  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = invModelMat.transpose();

  const lightViewMat = Matrix4.LookAt(lightDir.scale(5), Vector3.Zero);
  const lightProjMat = Matrix4.Ortho(shadowOrthoSize, 1, 1, 10);
  const worldLightSpaceMat = lightProjMat.multiply(lightViewMat);
  const modelLightDir = invModelMat.transformDirection(lightDir).normalize();
  const modelCamPos = invModelMat.transformPoint(camPos);
  const modelViewDir = invModelMat.transformDirection(viewDir).normalize();

  const isOrtho = orthoCb.checked;
  const viewMat = Matrix4.LookTo(camPos, cameraLookDir, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(FOV, aspectRatio);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

  return {
    renderSettings,
    modelMat,
    normalMat,
    worldLightSpaceMat,
    modelLightDir,
    modelCamPos,
    modelViewDir,
    isOrtho,
    mvp,
  };
};

const drawSoftware = (frameState: FrameState) => {
  const { renderSettings } = frameState;

  // 1) Clear all render targets for a new frame.
  if (renderSettings.showEnvironmentBackground) {
    frameBuffer.copyFrom(renderSettings.tonemap ? bgBufferTonemapped : bgBuffer);
  } else {
    frameBuffer.clear();
  }
  depthBuffer.clear(1000);
  shadowMap.clear(1000);

  // 5) Select active material shader and update uniforms.
  const shader = shaders[renderSettings.material];

  shader.uniforms = {
    model,
    modelMat: frameState.modelMat,
    mvp: frameState.mvp,
    normalMat: frameState.normalMat,
    worldLightDir: lightDir,
    envYaw,
    worldCamPos: camPos,
    orthographic: frameState.isOrtho,
    worldViewDir: viewDir,
    material,
    iblData,
    worldLightSpaceMat: frameState.worldLightSpaceMat,
    shadowMap,
    receiveShadows: renderSettings.useShadows,
  };
  shaders.depth.uniforms = { model, clipMat: frameState.mvp };

  // Optional shadow pass first
  if (renderSettings.useShadows) {
    shaders.depth.uniforms.clipMat = frameState.worldLightSpaceMat.multiply(frameState.modelMat);
    renderMesh(shaders.depth, shadowMap, "filled", shadowBuffer);
  }

  // We need a depth prepass for wireframe culling
  if (renderSettings.renderMode === "depthWireframe") {
    renderMesh(shaders.depth, depthBuffer, "filled");
  }

  // 6) Main render pass
  renderMesh(shader, depthBuffer, renderSettings.renderMode, frameBuffer, renderSettings.tonemap);
  ctx.putImageData(frameBuffer.imageData, 0, 0);
};

const drawWebGpu = (frameState: FrameState) => {
  if (!webGpuRenderer) {
    return false;
  }

  const { renderSettings } = frameState;
  const params: WebGpuRenderParams = {
    model,
    material: webGpuMaterial,
    iblData,
    materialMode: renderSettings.material,
    renderMode: renderSettings.renderMode,
    mvp: frameState.mvp,
    modelMat: frameState.modelMat,
    normalMat: frameState.normalMat,
    worldLightSpaceMat: frameState.worldLightSpaceMat,
    worldLightDir: lightDir,
    worldCamPos: camPos,
    worldViewDir: viewDir,
    envYaw,
    aspectRatio,
    fov: FOV,
    orthographic: frameState.isOrtho,
    useShadows: renderSettings.useShadows,
    showEnvironmentBackground: renderSettings.showEnvironmentBackground,
    tonemap: renderSettings.tonemap,
  };

  if (!webGpuRenderer.canRender(params.renderMode)) {
    return false;
  }

  try {
    webGpuRenderer.render(params);
    return true;
  } catch (error) {
    console.warn("WebGPU render failed; falling back to software renderer.", error);
    return false;
  }
};

const draw = () => {
  const frameState = getFrameState();
  const usedWebGpu = preferredRenderer === "webgpu" && drawWebGpu(frameState);

  if (usedWebGpu) {
    setActiveRenderer("webgpu");
    return;
  }

  setActiveRenderer("cpu");
  drawSoftware(frameState);
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
    const fps = Math.min(1000 / actualFrameTime, 1000);
    fpsText.innerText = `${actualFrameTime.toFixed(0)} ms (${fps.toFixed(0)} fps)`;
    lastFpsUiUpdate = now;
  }

  requestAnimationFrame(loop);
};

viewport.onpointerdown = (e) => {
  mouseButtonState = e.buttons;
};
window.onpointerup = (e) => {
  mouseButtonState = e.buttons;
};

let prevX = NaN;
let prevY = NaN;
viewport.onpointermove = (e) => {
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

viewport.onwheel = (e) => {
  e.preventDefault();
  const scale = Math.tan((FOV * 0.5 * Math.PI) / 180);
  orthoSize += (e.deltaY * scale) / ZOOM_SENSITIVITY;
  camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
};

viewport.oncontextmenu = (e) => e.preventDefault();

window.addEventListener("keydown", (event) => {
  if (modelDd.value !== "nyxy" && event.key.toLowerCase() === "n") {
    modelDd.value = "nyxy";
    modelDd.dispatchEvent(new Event("change"));
    return;
  }

  if (event.code === "Space") {
    if (!event.repeat) rotationPaused = !rotationPaused;
    event.preventDefault();
  } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
    const models = [...modelDd.options].filter((option) => !option.hidden);
    const index = models.findIndex((option) => option.value === modelDd.value);
    const nextIndex =
      (index + (event.key === "ArrowRight" ? 1 : -1) + models.length) % models.length;
    modelDd.value = models[nextIndex].value;
    modelDd.dispatchEvent(new Event("change"));
    event.preventDefault();
  } else if (event.key === "ArrowUp" || event.key === "ArrowDown") {
    shadingSlider.value = String(
      Math.min(10, Math.max(0, Number(shadingSlider.value) + (event.key === "ArrowUp" ? 1 : -1))),
    );
    syncShadingButtons();
    event.preventDefault();
  }
});

modelDd.onchange = () => {
  setModel(modelDd.value as ModelKey);
};

gpuCb.onchange = () => {
  preferredRenderer = gpuCb.checked && webGpuRenderer ? "webgpu" : "cpu";
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
