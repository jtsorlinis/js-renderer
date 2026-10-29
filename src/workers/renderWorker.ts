/// <reference lib="webworker" />

import { DepthTexture, Framebuffer, edgeFunction, line, triangle } from "../drawing";
import { Matrix4, Vector3, Vector4 } from "../maths";
import type { RenderMode } from "../renderSettings";
import { createShaders } from "../shaders";
import { BaseShader } from "../shaders/BaseShader";
import {
  deserializeScene,
  type Band,
  type ConfigureMessage,
  type RenderMessage,
  type WorkerRequest,
} from "./renderProtocol";

// Draws bands of the frame, taking them one at a time from a counter shared with the other workers
// until none are left. Each band is drawn into an ordinary band-sized Framebuffer and DepthTexture,
// so the unmodified triangle() and line() from src/drawing can draw into it.

const workerScope = self as DedicatedWorkerGlobalScope;

const shaders = createShaders();

type BandTarget = { frameBuffer: Framebuffer; depthBuffer: DepthTexture };

let scene: ReturnType<typeof deserializeScene>;
let bands: Band[] = [];
let frameWidth = 1;
let frameHeight = 1;
let rowBytes = 4;
let shadowMap = new DepthTexture(1, 1);
// Band heights differ by at most a row, so this holds one or two targets that every band reuses
let targets = new Map<number, BandTarget>();
// Shared with the main thread and the other workers
let nextBand: Int32Array = new Int32Array(1);
let pixels: Uint8ClampedArray = new Uint8ClampedArray(0);
let background: Uint8ClampedArray = new Uint8ClampedArray(0);

const configure = (message: ConfigureMessage) => {
  const { width, height, shadowMapSize } = message;
  scene = deserializeScene(message.scene);
  ({ bands, nextBand, pixels, background } = message);
  frameWidth = width;
  frameHeight = height;
  rowBytes = width * 4;
  targets = new Map();
  shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
  shadowMap.data = message.shadowMap;
};

const targetFor = (band: Band) => {
  let target = targets.get(band.height);
  if (!target) {
    target = {
      frameBuffer: new Framebuffer(frameWidth, band.height),
      depthBuffer: new DepthTexture(frameWidth, band.height),
    };
    targets.set(band.height, target);
  }
  return target;
};

const triVerts: Vector4[] = [];
const bandVerts = [new Vector4(), new Vector4(), new Vector4()];

// Framebuffer.snapToPixelGrid() for the full frame, as a band's framebuffer only knows its
// own height
const snapToPixelGrid = (v: Vector4) => {
  const halfWidth = frameWidth * 0.5;
  const halfHeight = frameHeight * 0.5;
  const screenX = (v.x + 1) * halfWidth;
  const screenY = (-v.y + 1) * halfHeight;
  const snappedX = Math.round(screenX);
  const snappedY = Math.round(screenY);

  v.x = snappedX / halfWidth - 1;
  v.y = 1 - snappedY / halfHeight;
  return v;
};

// Like main.ts renderMesh(), for one band. The band's framebuffer is its own little viewport, so
// y is remapped after the perspective divide to make the band fill NDC [-1, 1]. x is unchanged as
// bands are full width.
const renderBand = (
  activeShader: BaseShader,
  band: Band,
  { frameBuffer, depthBuffer }: BandTarget,
  triangles: Uint32Array,
  renderMode: RenderMode = "filled",
  perspectiveCorrect: boolean = true,
  snapVertices: boolean = false,
  pixelFn = frameBuffer.setPixel,
) => {
  const halfHeight = frameHeight * 0.5;
  const ndcScale = 2 / band.height;

  for (let t = 0; t < triangles.length; t++) {
    const i = triangles[t];
    for (let j = 0; j < 3; j++) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex().perspectiveDivide();
      if (snapVertices) {
        snapToPixelGrid(triVerts[j]);
      }
    }

    if (renderMode === "depthWireframe") {
      if (edgeFunction(triVerts[0], triVerts[1], triVerts[2]) <= 0) continue;
    }

    for (let j = 0; j < 3; j++) {
      const v = triVerts[j];
      const bandVert = bandVerts[j];
      // Pixel y in the full frame, as triangle() would compute it
      let y = (1 - v.y) * halfHeight;
      if (renderMode !== "filled") {
        // line() truncates endpoints toward zero, which rounds rows above the band (negative
        // here) the wrong way. Use the middle of the row the full-frame line would start on.
        const row = ~~y;
        y = row < band.y ? row - 0.5 : row + 0.5;
      }
      bandVert.x = v.x;
      bandVert.y = 1 - (y - band.y) * ndcScale;
      bandVert.z = v.z;
      bandVert.w = v.w;
    }

    if (renderMode === "filled") {
      triangle(bandVerts, activeShader, frameBuffer, depthBuffer, perspectiveCorrect, pixelFn);
    } else {
      line(bandVerts[0], bandVerts[1], frameBuffer, depthBuffer);
      line(bandVerts[1], bandVerts[2], frameBuffer, depthBuffer);
      line(bandVerts[2], bandVerts[0], frameBuffer, depthBuffer);
    }
  }
};

const toMatrix = (m: Float32Array) => {
  const matrix = new Matrix4();
  matrix.m = m;
  return matrix;
};

const render = (message: RenderMessage) => {
  const { settings, triangles, bandStarts } = message;
  const perspectiveCorrect = settings.perspectiveCorrect ?? true;
  const snapVertices = settings.snapVertices ?? false;

  // 1) Same uniforms as main.ts draw(), using the transforms the main thread built. The main
  // thread has already rendered this frame's shadow map into the shared one.
  const { model, material, iblData, envYaw, lightDir } = scene;
  const mvp = toMatrix(message.matrices.mvp);

  const shader = shaders[settings.material];
  shader.uniforms = {
    model,
    modelMat: toMatrix(message.matrices.modelMat),
    mvp,
    normalMat: toMatrix(message.matrices.normalMat),
    worldLightDir: lightDir,
    envYaw,
    worldCamPos: new Vector3(...message.camPos),
    material,
    iblData,
    worldLightSpaceMat: toMatrix(message.matrices.worldLightSpaceMat),
    shadowMap,
    receiveShadows: settings.useShadows,
    useSpecular: settings.useSpecular,
    disableTexture: settings.disableTexture,
    textureFiltering: settings.textureFiltering,
  };
  shaders.depth.uniforms = { model, clipMat: mvp };

  // 2) Take bands until none are left. A worker that falls behind (say it's on a slower core) just
  // ends up drawing fewer of them.
  for (let b = Atomics.add(nextBand, 0, 1); b < bands.length; b = Atomics.add(nextBand, 0, 1)) {
    const band = bands[b];
    const target = targetFor(band);
    const bandTriangles = triangles.subarray(bandStarts[b], bandStarts[b + 1]);

    const bandRows = (frame: Uint8ClampedArray) =>
      frame.subarray(band.y * rowBytes, (band.y + band.height) * rowBytes);
    if (settings.showEnvironmentBackground) {
      target.frameBuffer.data.set(bandRows(background));
    } else if (settings.vectorFade) {
      // Fade this band of the previous frame, which is still in pixels
      target.frameBuffer.data.set(bandRows(pixels));
      target.frameBuffer.fadeToBlack(message.dt * 6);
    } else {
      target.frameBuffer.clear();
    }
    target.depthBuffer.clear(1000);

    // We need a depth prepass for wireframe culling
    if (settings.renderMode === "depthWireframe") {
      renderBand(shaders.depth, band, target, bandTriangles, "filled");
    }
    const pixelFn = target.frameBuffer[settings.setPixelFn ?? "setPixel"];
    renderBand(
      shader,
      band,
      target,
      bandTriangles,
      settings.renderMode,
      perspectiveCorrect,
      snapVertices,
      pixelFn,
    );

    pixels.set(target.frameBuffer.data, band.y * rowBytes);
  }

  // 3) Tell the main thread this worker is done
  workerScope.postMessage(null);
};

workerScope.onmessage = (event: MessageEvent<WorkerRequest>) => {
  if (event.data.type === "configure") {
    configure(event.data);
  } else {
    render(event.data);
  }
};
