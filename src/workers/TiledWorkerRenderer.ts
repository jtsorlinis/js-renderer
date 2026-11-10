import { DepthTexture, Framebuffer, triangle } from "../drawing";
import { Matrix4, Vector3, Vector4 } from "../maths";
import type { Material } from "../materials/Material";
import type { RenderMode, RenderSelectionPreset } from "../renderSettings";
import { DepthShader } from "../shaders/Depth";
import type { IblData } from "../shaders/shaderHelpers";
import type { Mesh } from "../utils/mesh";
import {
  serializeScene,
  shareMemory,
  toTuple,
  type Band,
  type ConfigureMessage,
  type RenderMessage,
} from "./renderProtocol";

// Multithreaded version of main.ts draw(). The frame is cut into thin full-width bands, and
// workers take them one at a time from a shared counter until none are left, so the load stays
// balanced wherever the model is and however fast each worker's core happens to be. The main thread
// bins triangles by band and renders the shadow map once, then the workers draw the bands. The
// scene, shadow map, bins and frame live in shared memory, so all workers use one copy of each.

const MAX_WORKERS = 16;
const BANDS_PER_WORKER = 8;

// The transforms main.ts builds for each frame (draw() steps 2-4)
export interface FrameTransforms {
  modelMat: Matrix4;
  normalMat: Matrix4;
  worldLightSpaceMat: Matrix4;
  mvp: Matrix4;
}

// Everything main.ts draw() reads, plus the render targets
export interface TiledFrame {
  settings: RenderSelectionPreset;
  model: Mesh;
  material: Material;
  iblData: IblData;
  envYaw: { sin: number; cos: number };
  lightDir: Vector3;
  camPos: Vector3;
  viewDir: Vector3;
  isOrtho: boolean;
  transforms: FrameTransforms;
  frameBuffer: Framebuffer;
  background: Framebuffer;
  backgroundTonemapped: Framebuffer;
  shadowMapSize: number;
}

// Leave a core free for the main thread's binning and shadow pass
const defaultWorkerCount = () => {
  return Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 4) - 1));
};

export class TiledWorkerRenderer {
  private workers: Worker[];
  private bands: Band[] = [];
  // Band index of each row of the frame
  private rowBand = new Uint16Array(0);
  private configured?: { model: Mesh; material: Material; frameBuffer: Framebuffer };
  private depthShader = new DepthShader();
  private triVerts = [new Vector4(), new Vector4(), new Vector4()];
  // Shared with every worker: they take bands using nextBand, read each band's triangles and the
  // shadow map, and write their bands into pixels
  private nextBand = new Int32Array(new SharedArrayBuffer(4));
  private triangles: Uint32Array = new Uint32Array(0);
  private bandStarts: Uint32Array = new Uint32Array(0);
  private pixels: Uint8ClampedArray = new Uint8ClampedArray(0);
  private shadowMap = new DepthTexture(1, 1);
  private shadowBuffer = new Framebuffer(1, 1);

  constructor(workerCount = defaultWorkerCount()) {
    this.workers = Array.from(
      { length: workerCount },
      () => new Worker(new URL("./renderWorker.ts", import.meta.url), { type: "module" }),
    );
  }

  // Splits the frame into bands and sends each worker its bands and the scene
  private configure(frame: TiledFrame) {
    const { width, height } = frame.frameBuffer;
    const workerCount = this.workers.length;
    const bandCount = Math.max(1, Math.min(height, workerCount * BANDS_PER_WORKER));
    const bands: Band[] = [];
    this.bands = bands;
    this.bandStarts = new Uint32Array(new SharedArrayBuffer((bandCount + 1) * 4));
    this.rowBand = new Uint16Array(height);
    for (let band = 0; band < bandCount; band++) {
      const y = Math.floor((band * height) / bandCount);
      const nextY = Math.floor(((band + 1) * height) / bandCount);
      bands.push({ y, height: nextY - y });
      this.rowBand.fill(band, y, nextY);
    }

    const { shadowMapSize } = frame;
    this.pixels = new Uint8ClampedArray(new SharedArrayBuffer(width * height * 4));
    this.shadowMap = new DepthTexture(shadowMapSize, shadowMapSize);
    this.shadowMap.data = shareMemory(this.shadowMap.data);
    this.shadowBuffer = new Framebuffer(shadowMapSize, shadowMapSize);

    // Posting shared memory hands every worker the same buffers instead of a copy each
    const scene = shareMemory(
      serializeScene(
        frame.model,
        frame.material,
        frame.iblData,
        frame.envYaw,
        frame.lightDir,
        frame.viewDir,
      ),
    );
    const background = shareMemory(frame.background.data);
    const backgroundTonemapped = shareMemory(frame.backgroundTonemapped.data);

    const message: ConfigureMessage = {
      type: "configure",
      width,
      height,
      bands,
      nextBand: this.nextBand,
      scene,
      background,
      backgroundTonemapped,
      pixels: this.pixels,
      shadowMap: this.shadowMap.data,
      shadowMapSize,
    };
    for (const worker of this.workers) {
      worker.postMessage(message);
    }

    this.configured = {
      model: frame.model,
      material: frame.material,
      frameBuffer: frame.frameBuffer,
    };
  }

  // Renders the frame into frame.frameBuffer
  async draw(frame: TiledFrame) {
    const { settings, model, frameBuffer } = frame;
    const configured = this.configured;
    if (
      !configured ||
      configured.model !== model ||
      configured.material !== frame.material ||
      configured.frameBuffer !== frameBuffer
    ) {
      this.configure(frame);
    }

    const { modelMat, normalMat, worldLightSpaceMat, mvp } = frame.transforms;
    this.binTriangles(model, mvp, frameBuffer, settings.renderMode ?? "filled");

    // Shadow pass once on the main thread, into the shadow map the workers share
    if (settings.useShadows) {
      this.renderShadowMap(model, worldLightSpaceMat.multiply(modelMat));
    }

    const matrices = {
      modelMat: modelMat.m,
      normalMat: normalMat.m,
      mvp: mvp.m,
      worldLightSpaceMat: worldLightSpaceMat.m,
    };
    const message: RenderMessage = {
      type: "render",
      settings,
      matrices,
      camPos: toTuple(frame.camPos),
      orthographic: frame.isOrtho,
      triangles: this.triangles,
      bandStarts: this.bandStarts,
    };
    Atomics.store(this.nextBand, 0, 0);
    await Promise.all(this.workers.map((worker) => postAndWait(worker, message)));

    // The workers have written their bands into the shared frame. ImageData can't use shared
    // memory, so copy it across.
    frameBuffer.data.set(this.pixels);
  }

  // Stops the workers, freeing their copies of the scene
  dispose() {
    for (const worker of this.workers) {
      worker.terminate();
    }
  }

  // Lists the triangles that land in each band, packed band by band into shared memory
  private binTriangles(model: Mesh, mvp: Matrix4, buffer: Framebuffer, renderMode: RenderMode) {
    const { width, height } = buffer;
    const filled = renderMode === "filled";
    const cullBackfaces = renderMode !== "wireframe";
    const roundMin = filled ? Math.ceil : Math.floor;
    const bins = this.bands.map(() => [] as number[]);
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;

    // The depth shader only works out positions, which is all binning needs
    const shader = this.depthShader;
    shader.uniforms = { model, clipMat: mvp };
    shader.shadeVertices(model.vertices.length);
    const positions = shader.position.data;
    const { indices } = model;

    const triangleCount = indices.length / 3;
    for (let t = 0; t < triangleCount; t++) {
      const v0 = indices[t * 3] * 4;
      const v1 = indices[t * 3 + 1] * 4;
      const v2 = indices[t * 3 + 2] * 4;
      const z0 = positions[v0 + 2];
      const z1 = positions[v1 + 2];
      const z2 = positions[v2 + 2];

      if (filled) {
        if (z0 < 0 || z1 < 0 || z2 < 0) continue;
        if (z0 > 1 || z1 > 1 || z2 > 1) continue;
      }

      const p0x = (positions[v0] + 1) * halfWidth;
      const p0y = (-positions[v0 + 1] + 1) * halfHeight;
      const p1x = (positions[v1] + 1) * halfWidth;
      const p1y = (-positions[v1 + 1] + 1) * halfHeight;
      const p2x = (positions[v2] + 1) * halfWidth;
      const p2y = (-positions[v2 + 1] + 1) * halfHeight;

      if (
        (p0x < 0 && p1x < 0 && p2x < 0) ||
        (p0x > width && p1x > width && p2x > width) ||
        (p0y < 0 && p1y < 0 && p2y < 0) ||
        (p0y > height && p1y > height && p2y > height)
      ) {
        continue;
      }

      if (cullBackfaces) {
        const area = (p2x - p0x) * (p1y - p0y) - (p2y - p0y) * (p1x - p0x);
        if (area <= 0) continue;
      }

      // Same bounding box triangle() computes. line() truncates, so wireframes round down.
      const minX = roundMin(Math.max(0, Math.min(p0x, p1x, p2x)));
      const minY = roundMin(Math.max(0, Math.min(p0y, p1y, p2y)));
      const maxX = ~~Math.min(width - 1, Math.max(p0x, p1x, p2x));
      const maxY = ~~Math.min(height - 1, Math.max(p0y, p1y, p2y));
      if (minX > maxX || minY > maxY) continue;

      for (let band = this.rowBand[minY]; band <= this.rowBand[maxY]; band++) {
        bins[band].push(t);
      }
    }

    const count = bins.reduce((total, bin) => total + bin.length, 0);
    if (this.triangles.length < count) {
      // Grow with headroom, so it isn't reallocated every time the model turns
      this.triangles = new Uint32Array(new SharedArrayBuffer(count * 2 * 4));
    }
    let offset = 0;
    bins.forEach((bin, band) => {
      this.bandStarts[band] = offset;
      this.triangles.set(bin, offset);
      offset += bin.length;
    });
    this.bandStarts[bins.length] = offset;
  }

  // Same as the shadow pass in main.ts draw()
  private renderShadowMap(model: Mesh, clipMat: Matrix4) {
    const { shadowMap, shadowBuffer, triVerts } = this;
    const { indices } = model;
    const shader = this.depthShader;
    shadowMap.clear(1000);
    shader.uniforms = { model, clipMat };
    shader.shadeVertices(model.vertices.length);
    const triangleCount = indices.length / 3;
    for (let t = 0; t < triangleCount; t++) {
      shader.assembleTriangle(t, indices, triVerts);
      triangle(triVerts, shader, shadowBuffer, shadowMap);
    }
  }
}

const postAndWait = (worker: Worker, message: RenderMessage) => {
  return new Promise<void>((resolve, reject) => {
    worker.onmessage = () => resolve();
    worker.onerror = (event) => reject(new Error(event.message || "Render worker failed"));
    worker.postMessage(message);
  });
};
