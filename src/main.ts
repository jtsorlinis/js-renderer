import "./style.css";
import { Matrix4, Vector3, Vector4 } from "./maths";
import {
  DepthTexture,
  Framebuffer,
  edgeFunction,
  line,
  triangle,
} from "./drawing";
import { getModelRadius } from "./utils/mesh";
import {
  ensureModelOption,
  loadCustomGlb,
  prefetchRemainingModels,
  setHighResTextureLimits,
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
} from "./shaders/iblHelpers";
import { PathTracer } from "./pathTracing/PathTracer";
import { resolveShadingSelection, type RenderMode } from "./renderSettings";
import { loadHdrTexture } from "./utils/hdrLoader";

const CANVAS_WIDTH = 800;
const CANVAS_HEIGHT = 600;
const SHADOW_MAP_SIZE = 512;
const ROTATION_SPEED = 0.2;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;
const FPS_UPDATE_INTERVAL_MS = 250;
const PATH_TRACE_FRAME_BUDGET_MS = 16;

// UI handles
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const textureSizeText = document.getElementById(
  "textureSize",
) as HTMLSpanElement;
const orthographicCb = document.getElementById("orthoCb") as HTMLInputElement;
const highResCb = document.getElementById("highResCb") as HTMLInputElement;
const shadingList = document.getElementById("shadingList") as HTMLUListElement;
const shadingSlider = document.getElementById(
  "shadingSlider",
) as HTMLInputElement;
const modelDd = document.getElementById("modelDd") as HTMLSelectElement;
const loadGlbBtn = document.getElementById("loadGlbBtn") as HTMLButtonElement;
const glbInput = document.getElementById("glbInput") as HTMLInputElement;
const ctx = canvas.getContext("2d") as CanvasRenderingContext2D;
let pathTraceInteractive = true;

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
  pathTraceInteractive = true;
});

shadingSlider.addEventListener("input", () => {
  syncShadingButtons();
  pathTraceInteractive = true;
});

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
let zBuffer = new DepthTexture(CANVAS_WIDTH, CANVAS_HEIGHT);
let shadowMap = new DepthTexture(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowImageData = new ImageData(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
let shadowBuffer = new Framebuffer(shadowImageData);

const setRenderResolution = (scale = 1) => {
  const width = CANVAS_WIDTH * scale;
  const height = CANVAS_HEIGHT * scale;
  const shadowMapSize = SHADOW_MAP_SIZE * scale;

  canvas.width = width;
  canvas.height = height;
  aspectRatio = width / height;
  imageData = new ImageData(width, height);
  frameBuffer = new Framebuffer(imageData);
  zBuffer = new DepthTexture(width, height);
  shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
  shadowImageData = new ImageData(shadowMapSize, shadowMapSize);
  shadowBuffer = new Framebuffer(shadowImageData);
  fitCanvas();
};

setRenderResolution();
window.addEventListener("resize", fitCanvas);
setHighResTextureLimits(highResCb.checked);

const hdrEnvironment = await loadHdrTexture(
  `${import.meta.env.BASE_URL}environments/sunny.hdr`,
);

// Scene and camera
const lightDir = new Vector3(1, -1, 1).normalize();
const lightCol = new Vector3(1, 1, 1);
const camPos = new Vector3(0, 0, -2.5);
let cameraOrthoSize = 1.44;

// Derived scene data
const negLightDir = lightDir.scale(-1);
const cameraLookDir = Vector3.Forward;
const orthoViewDir = cameraLookDir.scale(-1);
const envYaw = estimateEnvironmentYaw(hdrEnvironment, lightDir);
const envYawSin = Math.sin(envYaw);
const envYawCos = Math.cos(envYaw);
const iblData = buildEnvironmentIbl(hdrEnvironment);

const diceModel = await ensureModelOption("dice");
prefetchRemainingModels("dice");

let model = diceModel.mesh;
let texture = diceModel.texture;
let normalTexture = diceModel.normalTexture;
let pbrMaterial = diceModel.pbrMaterial;
let shadowOrthoSize = getModelRadius(model);

let modelPos = new Vector3(0, 0, 0);
let modelRotation = new Vector3(0, Math.PI / 2, 0);
let modelScale = new Vector3(1, 1, 1);
let customGlbFile: File | null = null;

const shaders = {
  ibl: new IblShader(),
  pbr: new PbrShader(),
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
  unlit: new UnlitShader(),
};

type ShaderKey = keyof typeof shaders;
type RenderSettings = {
  material: ShaderKey | "pathTrace";
  renderMode: RenderMode;
  useShadows: boolean;
};

const depthShader = new DepthShader();
const pathTracer = new PathTracer();
const triVerts: Vector4[] = [];
let pathTraceStatsText = "";

const updateModelStats = () => {
  trisText.innerText = (model.vertices.length / 3).toFixed(0);
  textureSizeText.innerText = `${Math.max(texture.width, texture.height)}`;
};

const resetModelTransform = () => {
  modelRotation.set(0, Math.PI / 2, 0);
  camPos.set(0, 0, -2.5);
  cameraOrthoSize = 1.44;
  pathTraceInteractive = true;
};

let activeModelRequest = 0;

const applyModelOption = (selectedModel: ModelOption) => {
  model = selectedModel.mesh;
  texture = selectedModel.texture;
  normalTexture = selectedModel.normalTexture;
  pbrMaterial = selectedModel.pbrMaterial;
  shadowOrthoSize = getModelRadius(model);
  updateModelStats();
  pathTraceInteractive = true;
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
};

highResCb.addEventListener("change", () => {
  pathTraceInteractive = true;
  setRenderResolution(highResCb.checked ? 2 : 1);
  if (!setHighResTextureLimits(highResCb.checked)) return;
  if (customGlbFile) {
    loadSelectedGlb(customGlbFile, false);
    return;
  }
  setModel(modelDd.value as ModelKey, false);
});

orthographicCb.addEventListener("change", () => {
  pathTraceInteractive = true;
});

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
    material: selection.material,
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
  if (getShadingButton()?.dataset.shadingValue === "pathTrace") {
    return;
  }

  modelRotation.y -= dt * ROTATION_SPEED;
};

const draw = () => {
  const renderSettings = getRenderSettings();
  const previewRenderSettings =
    renderSettings.material === "pathTrace"
      ? resolveShadingSelection(
          "ibl",
          texture.data.length > 0 && model.uvs.length > 0,
        )
      : renderSettings;
  const usePathTracePreview =
    renderSettings.material === "pathTrace" && pathTraceInteractive;
  const activeRenderSettings = usePathTracePreview
    ? previewRenderSettings
    : renderSettings;
  if (renderSettings.material === "pathTrace") {
    pathTraceInteractive = false;
  }

  // 1) Build model-space transforms.
  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = invModelMat.transpose();

  if (renderSettings.material === "pathTrace" && !usePathTracePreview) {
    const pathTraceSampleCount = pathTracer.render(
      frameBuffer,
      {
        environment: hdrEnvironment,
        envYawCos,
        envYawSin,
        lightColor: lightCol,
        lightDirectionToLight: negLightDir,
        model,
        modelMat,
        invModelMat,
        normalMat,
        normalTexture,
        pbrMaterial,
        texture,
      },
      {
        aspectRatio,
        cameraOrthoSize,
        orthographic: orthographicCb.checked,
        position: camPos,
      },
      PATH_TRACE_FRAME_BUDGET_MS,
    );
    pathTraceStatsText = `${pathTraceSampleCount.toFixed(1)} samples`;
    ctx.putImageData(imageData, 0, 0);
    return;
  }

  pathTraceStatsText = usePathTracePreview ? "Preview" : "";

  // 2) Clear all render targets for a new frame.
  frameBuffer.clear();
  zBuffer.clear(1000);
  shadowMap.clear(1000);

  // 3) Build light-space transform (for shadow mapping).
  const lightViewMat = Matrix4.LookAt(lightDir.scale(-5), Vector3.Zero);
  const lightProjMat = Matrix4.Ortho(shadowOrthoSize, 1, 1, 10);
  const lightSpaceMat = lightProjMat.multiply(lightViewMat).multiply(modelMat);
  const modelLightDir = invModelMat.transformDirection(lightDir).normalize();
  const modelCamPos = invModelMat.transformPoint(camPos);
  const modelViewDir = invModelMat.transformDirection(orthoViewDir).normalize();

  // 4) Build camera transform and final clip transform.
  const isOrthographic = orthographicCb.checked;
  const viewMat = Matrix4.LookTo(camPos, cameraLookDir, Vector3.Up);
  const projMat = isOrthographic
    ? Matrix4.Ortho(cameraOrthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

  // 5) Select active material shader and update uniforms.
  if (activeRenderSettings.material === "pathTrace") {
    return;
  }
  const shader = shaders[activeRenderSettings.material];

  shader.uniforms = {
    model,
    modelMat,
    mvp,
    normalMat,
    lightDir,
    negLightDir,
    envYawSin,
    envYawCos,
    modelLightDir,
    lightCol,
    camPos,
    modelCamPos,
    orthographic: isOrthographic,
    worldViewDir: orthoViewDir,
    modelViewDir,
    texture,
    normalTexture,
    pbrMaterial,
    iblData,
    lightSpaceMat,
    shadowMap,
    receiveShadows: renderSettings.useShadows,
  };

  // 6) Optional shadow pass first, then visible color pass.
  if (activeRenderSettings.useShadows) {
    depthShader.uniforms = { model, clipMat: lightSpaceMat };
    renderMesh(depthShader, shadowMap, "filled", shadowBuffer);
  }

  // Depth only pass for wireframe culling
  if (activeRenderSettings.renderMode === "depthWireframe") {
    depthShader.uniforms = { model, clipMat: mvp };
    renderMesh(depthShader, zBuffer, "filled");
  }

  renderMesh(shader, zBuffer, activeRenderSettings.renderMode);
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
    const fps = frameIntervalMs > 0 ? 1000 / frameIntervalMs : 0;
    fpsText.innerText = pathTraceStatsText
      ? `${actualFrameTime.toFixed(0)} ms | ${pathTraceStatsText}`
      : `${actualFrameTime.toFixed(0)} ms (${fps.toFixed(0)} fps)`;
    lastFpsUiUpdate = now;
  }

  requestAnimationFrame(loop);
};

canvas.onmousemove = (e) => {
  if (e.buttons === 1) {
    modelRotation.y -= e.movementX / ROTATE_SENSITIVITY;
    modelRotation.x -= e.movementY / ROTATE_SENSITIVITY;
    pathTraceInteractive = true;
  } else if (e.buttons === 2 || e.buttons === 4) {
    camPos.x -= e.movementX / PAN_SENSITIVITY;
    camPos.y += e.movementY / PAN_SENSITIVITY;
    pathTraceInteractive = true;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  cameraOrthoSize += (e.deltaY * 0.58) / ZOOM_SENSITIVITY;
  camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
  pathTraceInteractive = true;
};

canvas.oncontextmenu = (e) => e.preventDefault();

window.addEventListener("keydown", (event) => {
  if (modelDd.value !== "nyxy" && event.key.toLowerCase() === "n") {
    modelDd.value = "nyxy";
    modelDd.dispatchEvent(new Event("change"));
  }
});

modelDd.onchange = () => {
  setModel(modelDd.value as ModelKey).catch((error) => {
    console.error(`Failed to switch to model "${modelDd.value}"`, error);
  });
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
