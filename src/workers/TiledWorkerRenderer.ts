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

const WORKER_COUNT = 4;

const createTilePixelBuffer = (tile: BufferRegion) => {
  return new Uint8ClampedArray(tile.width * tile.height * 4);
};

const buildTiles = (width: number, height: number) => {
  const columns = 2;
  const rows = 2;
  const tiles: BufferRegion[] = [];

  for (let row = 0; row < rows; row += 1) {
    const tileY = Math.floor((row * height) / rows);
    const nextTileY = Math.floor(((row + 1) * height) / rows);

    for (let column = 0; column < columns; column += 1) {
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
  private pendingFrame: {
    remaining: number;
    startedAt: number;
    target: ImageData;
    resolve: (elapsedMs: number) => void;
    reject: (error: Error) => void;
  } | null = null;

  get tiles() {
    return this.workers.map((workerSlot) => workerSlot.tile);
  }

  private createWorkers(width: number, height: number) {
    const tiles = buildTiles(width, height);
    this.workers = tiles.map((tile, index) => {
      const worker = new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" });
      worker.onmessage = (event: MessageEvent<WorkerResponseMessage>) => {
        this.handleRenderedMessage(index, event.data);
      };
      worker.onerror = (event) => {
        if (!this.pendingFrame) {
          return;
        }
        const reject = this.pendingFrame.reject;
        this.pendingFrame = null;
        reject(new Error(event.message || "Tile render worker failed"));
      };

      return {
        worker,
        tile,
        pixelBuffer: createTilePixelBuffer(tile),
        shadowMapBuffer: null,
      };
    });
  }

  private updateTiles(width: number, height: number) {
    const nextTiles = buildTiles(width, height);
    for (let i = 0; i < this.workers.length; i += 1) {
      const workerSlot = this.workers[i];
      const nextTile = nextTiles[i];
      workerSlot.tile = nextTile;
      if (!workerSlot.pixelBuffer || workerSlot.pixelBuffer.length !== nextTile.width * nextTile.height * 4) {
        workerSlot.pixelBuffer = createTilePixelBuffer(nextTile);
      }
    }
  }

  private ensureShadowBuffers(shadowMapSize: number) {
    const shadowMapPixelCount = shadowMapSize * shadowMapSize;
    for (const workerSlot of this.workers) {
      if (!workerSlot.shadowMapBuffer || workerSlot.shadowMapBuffer.length !== shadowMapPixelCount) {
        workerSlot.shadowMapBuffer = new Float32Array(shadowMapPixelCount);
      }
    }
  }

  configure(
    scene: StaticRenderScene,
    imageData: ImageData,
    shadowMapSize: number,
    fov: number,
    backgroundData: Uint8ClampedArray,
  ) {
    if (this.workers.length === 0) {
      this.createWorkers(imageData.width, imageData.height);
    }

    this.updateTiles(imageData.width, imageData.height);
    this.ensureShadowBuffers(shadowMapSize);
    const serializedScene = serializeStaticScene(
      scene,
      imageData.width,
      imageData.height,
      shadowMapSize,
      fov,
    );
    for (const workerSlot of this.workers) {
      const message: ConfigureWorkerMessage = {
        type: "configure",
        tile: workerSlot.tile,
        scene: {
          ...serializedScene,
          backgroundData: extractRegionRgba(backgroundData, imageData.width, workerSlot.tile),
        },
      };
      workerSlot.worker.postMessage(message);
    }
  }

  render(
    frame: FrameRenderState,
    target: ImageData,
    tileTriangleVertexIndices: Uint32Array[],
    sharedShadowMapData?: Float32Array,
  ) {
    if (this.pendingFrame) {
      throw new Error("A worker frame is already in flight");
    }

    if (this.workers.length !== WORKER_COUNT) {
      throw new Error("Render workers have not been configured");
    }

    const payload = serializeFrameState(frame);

    return new Promise<number>((resolve, reject) => {
      this.pendingFrame = {
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
        const outputBuffer = workerSlot.pixelBuffer!;
        const triangleVertexIndices = tileTriangleVertexIndices[workerIndex];

        const transferBuffers: Transferable[] = [
          outputBuffer.buffer as ArrayBuffer,
          triangleVertexIndices.buffer as ArrayBuffer,
        ];
        workerSlot.pixelBuffer = null;
        let shadowMapBuffer: ArrayBuffer | undefined;
        if (sharedShadowMapData) {
          const workerShadowMapBuffer = workerSlot.shadowMapBuffer!;
          workerShadowMapBuffer.set(sharedShadowMapData);
          workerSlot.shadowMapBuffer = null;
          shadowMapBuffer = workerShadowMapBuffer.buffer as ArrayBuffer;
          transferBuffers.push(shadowMapBuffer);
        }

        workerSlot.worker.postMessage(
          {
            type: "render",
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

  private handleRenderedMessage(index: number, message: WorkerRenderedMessage) {
    if (!this.pendingFrame) {
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
    this.pendingFrame = null;
  }
}
