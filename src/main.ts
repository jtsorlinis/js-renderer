import { createCanvas } from "canvas";
import { readFile } from "node:fs/promises";
import { performance } from "node:perf_hooks";
import { emitKeypressEvents } from "node:readline";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import terminalImage from "terminal-image";

import { DepthTexture, Framebuffer, Texture, line, triangle } from "./drawing";
import { Matrix4, Vector3, Vector4 } from "./maths";
import { resolveShadingSelection } from "./renderSettings";
import { DepthShader } from "./shaders/DepthShader";
import { FlatShader } from "./shaders/Flat";
import { BaseShader } from "./shaders/BaseShader";
import { NormalMappedShader } from "./shaders/NormalMapped";
import { SmoothShader } from "./shaders/Smooth";
import { TexturedShader } from "./shaders/Textured";
import { loadObj } from "./utils/objLoader";

const CANVAS_WIDTH = 220;
const CANVAS_HEIGHT = 165;
const ROTATION_SPEED = 5;
const MIN_FPS = 1;
const MAX_FPS = 60;
const DEFAULT_FPS = 15;
const DEFAULT_SHADING_MODE = "normalMapped-shadows";
const HEADER_LINE_COUNT = 4;
const TERMINAL_BOTTOM_PADDING = 1;
const MIN_IMAGE_ROWS = 4;
const SHADING_MODES = [
  "normalMapped-shadows",
  "normalMapped",
  "textured",
  "smooth",
  "flat",
  "wireframe",
] as const;

const useOrthographic = false;
const forceWireframe = false;
const disableShadows = false;
let targetFps = DEFAULT_FPS;
let frameDurationMs = 1000 / targetFps;
let initialTerminalSize: { rows: number; columns: number } | null = null;

const canvas = createCanvas(CANVAS_WIDTH, CANVAS_HEIGHT);
const ctx = canvas.getContext("2d");
const aspectRatio = CANVAS_WIDTH / CANVAS_HEIGHT;

const image = ctx.createImageData(CANVAS_WIDTH, CANVAS_HEIGHT);
const frameBuffer = new Framebuffer(image);
const zBuffer = new DepthTexture(CANVAS_WIDTH, CANVAS_HEIGHT);
const shadowMap = new DepthTexture(CANVAS_WIDTH, CANVAS_HEIGHT);

const lightDir = new Vector3(0, -1, 1).normalize();
const lightCol = new Vector3(1, 1, 1);

const camPos = new Vector3(0, 0, -2.5);
const orthoSize = 1.5;

const modelSource = await readFile(
  fileURLToPath(new URL("./models/head.obj", import.meta.url)),
  "utf8",
);
const model = loadObj(modelSource, true);
const texture = await Texture.Load(
  fileURLToPath(new URL("./models/head_diffuse.png", import.meta.url)),
);
const normalTexture = await Texture.Load(
  fileURLToPath(new URL("./models/head_normal_t.png", import.meta.url)),
  true,
);

const shaders = {
  normalMapped: new NormalMappedShader(),
  textured: new TexturedShader(),
  smooth: new SmoothShader(),
  flat: new FlatShader(),
};

type ShaderKey = keyof typeof shaders;
type ShadingMode = (typeof SHADING_MODES)[number];
type Keypress = { name?: string; ctrl?: boolean };
type RenderSettings = {
  shaderKey: ShaderKey;
  wireframe: boolean;
  useShadows: boolean;
};

const canUseTexturedModes = texture.data.length > 0 && model.uvs.length > 0;
const selection = resolveShadingSelection(
  DEFAULT_SHADING_MODE,
  canUseTexturedModes,
);
let currentShadingMode = selection.normalizedValue;
let shadingModeIndex = findShadingModeIndex(currentShadingMode);
const renderSettings: RenderSettings = {
  shaderKey: "smooth",
  wireframe: false,
  useShadows: false,
};

const depthShader = new DepthShader();
const triVerts: Vector4[] = [];

const modelPos = new Vector3(0, 0, 0);
const modelRotation = new Vector3(0, -Math.PI / 2, 0);
const modelScale = new Vector3(1, 1, 1);
const applyShadingMode = (mode: string) => {
  const next = resolveShadingSelection(mode, canUseTexturedModes);
  currentShadingMode = next.normalizedValue;
  shadingModeIndex = findShadingModeIndex(currentShadingMode);
  renderSettings.shaderKey = next.material;
  renderSettings.wireframe = next.wireframe || forceWireframe;
  renderSettings.useShadows = next.useShadows && !disableShadows;
};
const changeTargetFps = (delta: number) => {
  targetFps = Math.max(MIN_FPS, Math.min(MAX_FPS, targetFps + delta));
  frameDurationMs = 1000 / targetFps;
};
const cycleShadingMode = (delta: -1 | 1) => {
  shadingModeIndex =
    (shadingModeIndex + delta + SHADING_MODES.length) % SHADING_MODES.length;
  applyShadingMode(SHADING_MODES[shadingModeIndex]);
};

applyShadingMode(currentShadingMode);

const renderMesh = (
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  wireframe = false,
) => {
  for (let i = 0; i < model.vertices.length; i += 3) {
    for (let j = 0; j < 3; j++) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex();
    }

    if (wireframe) {
      line(triVerts[0], triVerts[1], frameBuffer);
      line(triVerts[1], triVerts[2], frameBuffer);
      line(triVerts[2], triVerts[0], frameBuffer);
      continue;
    }

    triangle(triVerts, activeShader, frameBuffer, depthBuffer);
  }
};

const update = (dt: number) => {
  modelRotation.y -= dt / ROTATION_SPEED;
};

const draw = () => {
  frameBuffer.clear();
  zBuffer.clear(1000);
  shadowMap.clear(1000);

  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = modelMat.invert().transpose();

  const lightViewMat = Matrix4.LookTo(lightDir.scale(-5), lightDir, Vector3.Up);
  const lightProjMat = Matrix4.Ortho(orthoSize, aspectRatio);
  const lightSpaceMat = modelMat.multiply(lightViewMat.multiply(lightProjMat));
  const mLightDir = invModelMat.multiplyDirection(lightDir).normalize();
  const mCamPos = invModelMat.multiplyPoint(camPos).xyz;

  const viewMat = Matrix4.LookTo(camPos, Vector3.Forward, Vector3.Up);
  const projMat = useOrthographic
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mvp = modelMat.multiply(viewMat).multiply(projMat);

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

  if (renderSettings.useShadows) {
    renderMesh(depthShader, shadowMap);
  }

  renderMesh(shader, zBuffer, renderSettings.wireframe);
  ctx.putImageData(image, 0, 0);
};

const readTerminalSize = () => {
  const rows = process.stdout.rows;
  const columns = process.stdout.columns;
  if (!rows || !columns) {
    return null;
  }

  return { rows, columns };
};

const enterTerminalCanvas = () => {
  if (!process.stdout.isTTY) {
    throw new Error("A TTY terminal is required to render frames.");
  }

  initialTerminalSize = readTerminalSize();

  // Best-effort maximize for terminals that support xterm window operations.
  process.stdout.write("\u001b[9;1t");
  process.stdout.write("\u001b[?1049h");
  process.stdout.write("\u001b[?25l");
};

const exitTerminalCanvas = () => {
  if (!process.stdout.isTTY) {
    return;
  }

  // Best-effort restore of the original window dimensions.
  if (initialTerminalSize) {
    process.stdout.write(
      `\u001b[8;${initialTerminalSize.rows};${initialTerminalSize.columns}t`,
    );
  }
  initialTerminalSize = null;

  process.stdout.write("\u001b[?25h");
  process.stdout.write("\u001b[?1049l");
};

const frameHeader = (frameTimeMs: number) => {
  const triCount = (model.vertices.length / 3).toFixed(0);
  const mode = `${renderSettings.shaderKey}${
    renderSettings.wireframe ? "+wireframe" : ""
  }${renderSettings.useShadows ? "+shadows" : ""}`;

  return (
    `JS Renderer (terminal) | ${CANVAS_WIDTH}x${CANVAS_HEIGHT}\n` +
    `Controls: ↑/↓ FPS, ←/→ shading mode, q quit\n` +
    `Triangles: ${triCount} | Mode: ${mode} | Frame: ${frameTimeMs.toFixed(
      1,
    )}ms | Target: ${targetFps} FPS | Shading: ${currentShadingMode}\n\n`
  );
};

const getImageHeightRows = () => {
  const rows = process.stdout.rows ?? 24;
  return Math.max(
    MIN_IMAGE_ROWS,
    rows - HEADER_LINE_COUNT - TERMINAL_BOTTOM_PADDING,
  );
};

const setupInput = (stop: () => void) => {
  if (!process.stdin.isTTY) {
    return () => {};
  }

  emitKeypressEvents(process.stdin);
  process.stdin.setRawMode(true);
  process.stdin.resume();

  const onKeypress = (_: string, key: Keypress) => {
    if (key.ctrl && key.name === "c") {
      stop();
      return;
    }

    switch (key.name) {
      case "up":
        changeTargetFps(1);
        break;
      case "down":
        changeTargetFps(-1);
        break;
      case "left":
        cycleShadingMode(-1);
        break;
      case "right":
        cycleShadingMode(1);
        break;
      case "q":
        stop();
        break;
      default:
        break;
    }
  };

  process.stdin.on("keypress", onKeypress);

  return () => {
    process.stdin.off("keypress", onKeypress);
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(false);
    }
    process.stdin.pause();
  };
};

const renderLoop = async () => {
  let running = true;
  const stop = () => {
    running = false;
  };

  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  enterTerminalCanvas();
  const teardownInput = setupInput(stop);
  let prevTime = performance.now();

  try {
    while (running) {
      const frameStart = performance.now();
      const deltaTime = (frameStart - prevTime) / 1000;
      prevTime = frameStart;

      update(deltaTime);
      draw();

      const imageBuffer = canvas.toBuffer("image/png");
      const renderedFrame = await terminalImage.buffer(imageBuffer, {
        width: "100%",
        height: getImageHeightRows(),
        preserveAspectRatio: true,
      });
      const frameTimeMs = performance.now() - frameStart;

      process.stdout.write("\u001b[2J\u001b[H");
      process.stdout.write(frameHeader(frameTimeMs));
      process.stdout.write(renderedFrame);
      process.stdout.write("\n");

      const remaining = frameDurationMs - (performance.now() - frameStart);
      if (remaining > 0) {
        await delay(remaining);
      }
    }
  } finally {
    teardownInput();
    exitTerminalCanvas();
  }
};

await renderLoop();

function findShadingModeIndex(mode: string): number {
  const index = SHADING_MODES.indexOf(mode as ShadingMode);
  if (index !== -1) {
    return index;
  }

  return SHADING_MODES.indexOf("smooth");
}
