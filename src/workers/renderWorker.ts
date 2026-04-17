/// <reference lib="webworker" />

import { DepthTexture, Framebuffer } from "../drawing";
import { createShaders, drawScene } from "../renderer/renderCore";
import {
  deserializeFrameState,
  deserializeStaticScene,
  type WorkerRequestMessage,
  type WorkerResponseMessage,
} from "./renderProtocol";

const workerScope = self as DedicatedWorkerGlobalScope;
const shaders = createShaders();

let frameFov = 50;
let tile = { x: 0, y: 0, width: 1, height: 1 };
let scene: ReturnType<typeof deserializeStaticScene> | null = null;
let frameBuffer = new Framebuffer({ width: 1, height: 1 });
let backgroundBuffer = new Framebuffer({ width: 1, height: 1 });
let depthBuffer = new DepthTexture(1, 1);
let shadowMap = new DepthTexture(1, 1);
let shadowBuffer = new Framebuffer({ width: 1, height: 1 });
let fullWidth = 1;
let fullHeight = 1;

const createTileBuffers = (nextFullWidth: number, nextFullHeight: number, shadowMapSize: number) => {
  fullWidth = nextFullWidth;
  fullHeight = nextFullHeight;
  depthBuffer = new DepthTexture(fullWidth, fullHeight, { region: tile });
  shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
  shadowBuffer = new Framebuffer({
    width: shadowMapSize,
    height: shadowMapSize,
  });
};

const bindOutputBuffer = (buffer: ArrayBuffer) => {
  frameBuffer = new Framebuffer({
    width: fullWidth,
    height: fullHeight,
    region: tile,
    data: new Uint8ClampedArray(buffer),
  });
};

const bindShadowMapBuffer = (buffer: ArrayBuffer) => {
  shadowMap.data = new Float32Array(buffer);
};

const sendMessage = (message: WorkerResponseMessage, transfer: Transferable[] = []) => {
  workerScope.postMessage(message, transfer);
};

workerScope.onmessage = (event: MessageEvent<WorkerRequestMessage>) => {
  const message = event.data;
  if (message.type === "configure") {
    tile = message.tile;
    frameFov = message.scene.fov;
    scene = deserializeStaticScene(message.scene);
    backgroundBuffer = new Framebuffer({
      width: message.scene.fullWidth,
      height: message.scene.fullHeight,
      region: tile,
      data: message.scene.backgroundData,
    });
    createTileBuffers(
      message.scene.fullWidth,
      message.scene.fullHeight,
      message.scene.shadowMapSize,
    );
    return;
  }

  bindOutputBuffer(message.outputBuffer);
  if (message.shadowMapBuffer) {
    bindShadowMapBuffer(message.shadowMapBuffer);
  }
  const frame = deserializeFrameState(message.frame);
  drawScene(
    scene!,
    frame,
    {
      frameBuffer,
      depthBuffer,
      shadowMap,
      shadowBuffer,
      backgroundBuffer,
    },
    shaders,
    frameFov,
    {
      triangleVertexIndices: message.triangleVertexIndices,
      skipShadowPass: Boolean(message.shadowMapBuffer),
    },
  );

  sendMessage(
    {
      type: "rendered",
      pixels: frameBuffer.data,
      shadowMapBuffer: message.shadowMapBuffer ? shadowMap.data : undefined,
    },
    message.shadowMapBuffer
      ? [frameBuffer.data.buffer, shadowMap.data.buffer]
      : [frameBuffer.data.buffer],
  );
};
