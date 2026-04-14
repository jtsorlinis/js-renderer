import type { BufferRegion } from "../drawing/Framebuffer";
import type { FrameRenderState, StaticRenderScene } from "../renderer/renderCore";
import {
  blitRegionRgba,
  extractRegionRgba,
  serializeFrameState,
  serializeStaticScene,
  type ConfigureWorkerMessage,
  type WorkerResponseMessage,
  type WorkerRenderedMessage,
} from "./renderProtocol";

type WorkerSlot = {
  worker: Worker;
  tile: BufferRegion;
  pixelBuffer: Uint8ClampedArray | null;
  shadowMapBuffer: Float32Array | null;
};

const createTilePixelBuffer = (tile: BufferRegion) => {
  return new Uint8ClampedArray(tile.width * tile.height * 4);
};

const buildTiles = (width: number, height: number, workerCount: number) => {
  const columns = Math.ceil(Math.sqrt(workerCount));
  const rows = Math.ceil(workerCount / columns);
  const tiles: BufferRegion[] = [];

  for (let row = 0; row < rows; row += 1) {
    const tileY = Math.floor((row * height) / rows);
    const nextTileY = Math.floor(((row + 1) * height) / rows);

    for (let column = 0; column < columns && tiles.length < workerCount; column += 1) {
      const tileX = Math.floor((column * width) / columns);
      const nextTileX = Math.floor(((column + 1) * width) / columns);
      tiles.push({
        x: tileX,
        y: tileY,
        width: nextTileX - tileX,
        height: nextTileY - tileY,
      });
    }
  }

  return tiles;
};

export class TiledWorkerRenderer {
  private workers: WorkerSlot[] = [];
  private sceneVersion = 0;
  private nextFrameId = 0;
  private configured = false;
  private pendingConfigure: {
    sceneVersion: number;
    remaining: number;
    resolve: () => void;
    reject: (error: Error) => void;
  } | null = null;
  private pendingFrame: {
    frameId: number;
    sceneVersion: number;
    remaining: number;
    startedAt: number;
    target: ImageData;
    resolve: (elapsedMs: number) => void;
    reject: (error: Error) => void;
  } | null = null;

  constructor(private readonly workerCount: number) {}

  get isConfigured() {
    return this.configured;
  }

  get isRendering() {
    return this.pendingFrame !== null;
  }

  get tiles() {
    return this.workers.map((workerSlot) => workerSlot.tile);
  }

  private ensureWorkers(width: number, height: number) {
    if (this.workers.length === this.workerCount) {
      const nextTiles = buildTiles(width, height, this.workerCount);
      for (let i = 0; i < this.workers.length; i += 1) {
        const workerSlot = this.workers[i];
        const nextTile = nextTiles[i];
        workerSlot.tile = nextTile;
        if (
          !workerSlot.pixelBuffer ||
          workerSlot.pixelBuffer.length !== nextTile.width * nextTile.height * 4
        ) {
          workerSlot.pixelBuffer = createTilePixelBuffer(nextTile);
        }
      }
      return;
    }

    this.dispose();
    const tiles = buildTiles(width, height, this.workerCount);
    this.workers = tiles.map((tile, index) => {
      const worker = new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        this.handleWorkerMessage(index, event.data);
      };
      worker.onerror = (event) => {
        const error = new Error(event.message || "Tile render worker failed");
        this.pendingConfigure?.reject(error);
        this.pendingFrame?.reject(error);
        this.pendingConfigure = null;
        this.pendingFrame = null;
        this.configured = false;
      };

      return {
        worker,
        tile,
        pixelBuffer: createTilePixelBuffer(tile),
        shadowMapBuffer: null,
      };
    });
  }

  async configure(
    scene: StaticRenderScene,
    imageData: ImageData,
    shadowMapSize: number,
    fov: number,
    backgroundData: Uint8ClampedArray,
  ) {
    if (this.pendingFrame) {
      await new Promise<void>((resolve) => {
        const pendingFrame = this.pendingFrame;
        if (!pendingFrame) {
          resolve();
          return;
        }

        const finish = () => resolve();
        const originalResolve = pendingFrame.resolve;
        const originalReject = pendingFrame.reject;
        pendingFrame.resolve = (elapsedMs) => {
          originalResolve(elapsedMs);
          finish();
        };
        pendingFrame.reject = (error) => {
          originalReject(error);
          finish();
        };
      });
    }

    this.ensureWorkers(imageData.width, imageData.height);
    const shadowMapPixelCount = shadowMapSize * shadowMapSize;
    for (const workerSlot of this.workers) {
      if (
        !workerSlot.shadowMapBuffer ||
        workerSlot.shadowMapBuffer.length !== shadowMapPixelCount
      ) {
        workerSlot.shadowMapBuffer = new Float32Array(shadowMapPixelCount);
      }
    }
    const serializedScene = serializeStaticScene(
      scene,
      imageData.width,
      imageData.height,
      shadowMapSize,
      fov,
    );
    const sceneVersion = ++this.sceneVersion;
    this.configured = false;

    await new Promise<void>((resolve, reject) => {
      this.pendingConfigure = {
        sceneVersion,
        remaining: this.workers.length,
        resolve: () => {
          this.pendingConfigure = null;
          this.configured = true;
          resolve();
        },
        reject: (error) => {
          this.pendingConfigure = null;
          reject(error);
        },
      };

      for (const workerSlot of this.workers) {
        const message: ConfigureWorkerMessage = {
          type: "configure",
          sceneVersion,
          tile: workerSlot.tile,
          scene: {
            ...serializedScene,
            backgroundData: extractRegionRgba(backgroundData, imageData.width, workerSlot.tile),
          },
        };
        workerSlot.worker.postMessage(message);
      }
    });
  }

  render(
    frame: FrameRenderState,
    target: ImageData,
    tileTriangleVertexIndices: Uint32Array[],
    sharedShadowMapData?: Float32Array,
  ) {
    if (!this.configured) {
      return Promise.reject(new Error("Worker renderer is not configured"));
    }

    if (this.pendingFrame) {
      return Promise.reject(new Error("A worker frame is already in flight"));
    }

    if (tileTriangleVertexIndices.length !== this.workers.length) {
      return Promise.reject(new Error("Triangle bin count does not match worker count"));
    }

    const frameId = ++this.nextFrameId;
    const sceneVersion = this.sceneVersion;
    const payload = serializeFrameState(frame);

    return new Promise<number>((resolve, reject) => {
      this.pendingFrame = {
        frameId,
        sceneVersion,
        remaining: this.workers.length,
        startedAt: performance.now(),
        target,
        resolve: (elapsedMs) => {
          this.pendingFrame = null;
          resolve(elapsedMs);
        },
        reject: (error) => {
          this.pendingFrame = null;
          reject(error);
        },
      };

      for (let workerIndex = 0; workerIndex < this.workers.length; workerIndex += 1) {
        const workerSlot = this.workers[workerIndex];
        const outputBuffer = workerSlot.pixelBuffer;
        const triangleVertexIndices = tileTriangleVertexIndices[workerIndex];
        if (!outputBuffer) {
          reject(new Error("Tile buffer missing before worker render dispatch"));
          return;
        }

        const transferBuffers: Transferable[] = [
          outputBuffer.buffer as ArrayBuffer,
          triangleVertexIndices.buffer as ArrayBuffer,
        ];
        workerSlot.pixelBuffer = null;
        let shadowMapBuffer: ArrayBuffer | undefined;
        if (sharedShadowMapData) {
          const workerShadowMapBuffer = workerSlot.shadowMapBuffer;
          if (!workerShadowMapBuffer) {
            reject(new Error("Shadow map buffer missing before worker render dispatch"));
            return;
          }
          workerShadowMapBuffer.set(sharedShadowMapData);
          workerSlot.shadowMapBuffer = null;
          shadowMapBuffer = workerShadowMapBuffer.buffer as ArrayBuffer;
          transferBuffers.push(shadowMapBuffer);
        }

        workerSlot.worker.postMessage(
          {
            type: "render",
            sceneVersion,
            frameId,
            frame: payload,
            outputBuffer: outputBuffer.buffer,
            triangleVertexIndices,
            shadowMapBuffer,
          },
          transferBuffers,
        );
      }
    });
  }

  private handleWorkerMessage(index: number, message: WorkerResponseMessage) {
    if (message.type === "error") {
      const error = new Error(message.message);
      this.pendingConfigure?.reject(error);
      this.pendingFrame?.reject(error);
      this.pendingConfigure = null;
      this.pendingFrame = null;
      this.configured = false;
      return;
    }

    if (message.type === "configured") {
      if (!this.pendingConfigure || message.sceneVersion !== this.pendingConfigure.sceneVersion) {
        return;
      }

      this.pendingConfigure.remaining -= 1;
      if (this.pendingConfigure.remaining === 0) {
        this.pendingConfigure.resolve();
      }
      return;
    }

    this.handleRenderedMessage(index, message);
  }

  private handleRenderedMessage(index: number, message: WorkerRenderedMessage) {
    if (
      !this.pendingFrame ||
      message.sceneVersion !== this.pendingFrame.sceneVersion ||
      message.frameId !== this.pendingFrame.frameId
    ) {
      return;
    }

    blitRegionRgba(
      this.pendingFrame.target.data,
      this.pendingFrame.target.width,
      this.workers[index].tile,
      message.pixels,
    );
    this.workers[index].pixelBuffer = message.pixels;
    if (message.shadowMapBuffer) {
      this.workers[index].shadowMapBuffer = message.shadowMapBuffer;
    }
    this.pendingFrame.remaining -= 1;

    if (this.pendingFrame.remaining === 0) {
      const elapsedMs = performance.now() - this.pendingFrame.startedAt;
      this.pendingFrame.resolve(elapsedMs);
    }
  }

  dispose() {
    for (const workerSlot of this.workers) {
      workerSlot.worker.terminate();
    }
    this.workers = [];
    this.pendingConfigure = null;
    this.pendingFrame = null;
    this.configured = false;
  }
}
