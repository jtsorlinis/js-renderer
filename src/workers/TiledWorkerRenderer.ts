import { DepthTexture, Framebuffer, triangle } from "../drawing";
import { Matrix4, Vector3, Vector4 } from "../maths";
import type { Material } from "../materials/Material";
import type { RenderSelection } from "../renderSettings";
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

// Opt-in multithreaded version of main.ts draw(). The frame is cut into thin full-width bands, and
// workers take them one at a time from a shared counter until none are left, so the load stays
// balanced wherever the model is and however fast each worker's core happens to be. The main thread
// bins triangles by band and renders the shadow map once, then the workers draw the bands. The
// scene, shadow map, bins and frame live in shared memory, so all workers use one copy of each.

const MAX_WORKERS = 16;
const BANDS_PER_WORKER = 8;
// Bands start on a multiple of this many rows. Framebuffer's dithering picks its 4x4 Bayer
// threshold from the pixel's y in the band, which then matches its y in the full frame.
const BAND_ROW_ALIGNMENT = 4;

// Everything main.ts draw() reads, plus the render targets
export interface TiledFrame {
  settings: RenderSelection;
  // Seconds since the previous frame, for the vector fade
  dt: number;
  model: Mesh;
  material: Material;
  iblData: IblData;
  envYaw: { sin: number; cos: number };
  lightDir: Vector3;
  shadowOrthoSize: number;
  modelPos: Vector3;
  modelRotation: Vector3;
  modelScale: Vector3;
  camPos: Vector3;
  aspectRatio: number;
  fov: number;
  frameBuffer: Framebuffer;
  background: Framebuffer;
  shadowMapSize: number;
}

// Leave a core free for the main thread's binning and shadow pass
const defaultWorkerCount = () => {
  return Math.max(1, Math.min(MAX_WORKERS, (navigator.hardwareConcurrency || 4) - 1));
};

const cameraLookDir = Vector3.Forward;

export class TiledWorkerRenderer {
  private workers: Worker[];
  private bands: Band[] = [];
  // Band index of each row of the frame
  private rowBand = new Uint16Array(0);
  private configured?: { model: Mesh; material: Material; frameBuffer: Framebuffer };
  private depthShader = new DepthShader();
  private triVerts: Vector4[] = [];
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
    const rowGroups = Math.ceil(height / BAND_ROW_ALIGNMENT);
    const bandCount = Math.max(1, Math.min(rowGroups, workerCount * BANDS_PER_WORKER));
    const bands: Band[] = [];
    this.bands = bands;
    this.bandStarts = new Uint32Array(new SharedArrayBuffer((bandCount + 1) * 4));
    this.rowBand = new Uint16Array(height);
    const bandY = (band: number) =>
      Math.min(height, Math.floor((band * rowGroups) / bandCount) * BAND_ROW_ALIGNMENT);
    for (let band = 0; band < bandCount; band++) {
      const y = bandY(band);
      const nextY = bandY(band + 1);
      bands.push({ y, height: nextY - y });
      this.rowBand.fill(band, y, nextY);
    }

    const { shadowMapSize } = frame;
    this.pixels = new Uint8ClampedArray(new SharedArrayBuffer(width * height * 4));
    // Start from the frame on screen, so the vector fade carries on from it
    this.pixels.set(frame.frameBuffer.data);
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
      ),
    );
    const background = shareMemory(frame.background.data);

    const message: ConfigureMessage = {
      type: "configure",
      width,
      height,
      bands,
      nextBand: this.nextBand,
      scene,
      background,
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

    // Same transforms as main.ts draw() steps 2-4
    const modelMat = Matrix4.TRS(frame.modelPos, frame.modelRotation, frame.modelScale);
    const invModelMat = modelMat.invert();
    const normalMat = invModelMat.transpose();

    const lightViewMat = Matrix4.LookAt(frame.lightDir.scale(5), Vector3.Zero);
    const lightProjMat = Matrix4.Ortho(frame.shadowOrthoSize, 1, 1, 10);
    const worldLightSpaceMat = lightProjMat.multiply(lightViewMat);

    const viewMat = Matrix4.LookTo(frame.camPos, cameraLookDir, Vector3.Up);
    const projMat = Matrix4.Perspective(frame.fov, frame.aspectRatio);
    const mvp = projMat.multiply(viewMat).multiply(modelMat);

    this.binTriangles(model, mvp, frameBuffer, settings);

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
      dt: frame.dt,
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
  private binTriangles(model: Mesh, mvp: Matrix4, buffer: Framebuffer, settings: RenderSelection) {
    const { width, height } = buffer;
    const bins = this.bands.map(() => [] as number[]);
    const halfWidth = width * 0.5;
    const halfHeight = height * 0.5;
    const filled = (settings.renderMode ?? "filled") === "filled";
    const cullBackfaces = settings.renderMode !== "wireframe";

    for (let i = 0; i < model.vertices.length; i += 3) {
      const v0 = mvp.transformPoint4(model.vertices[i]).perspectiveDivide();
      const v1 = mvp.transformPoint4(model.vertices[i + 1]).perspectiveDivide();
      const v2 = mvp.transformPoint4(model.vertices[i + 2]).perspectiveDivide();
      // Bin where the workers will draw it
      if (settings.snapVertices) {
        buffer.snapToPixelGrid(v0);
        buffer.snapToPixelGrid(v1);
        buffer.snapToPixelGrid(v2);
      }

      // triangle() skips these, but line() clips each edge on its own, so in the line modes a
      // triangle crossing the near plane can still have edges to draw
      if (filled) {
        if (v0.z < 0 || v1.z < 0 || v2.z < 0) continue;
        if (v0.z > 1 || v1.z > 1 || v2.z > 1) continue;
      }

      const p0x = (v0.x + 1) * halfWidth;
      const p0y = (-v0.y + 1) * halfHeight;
      const p1x = (v1.x + 1) * halfWidth;
      const p1y = (-v1.y + 1) * halfHeight;
      const p2x = (v2.x + 1) * halfWidth;
      const p2y = (-v2.y + 1) * halfHeight;

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

      // Same bounding box triangle() computes
      const minX = ~~Math.max(0, Math.min(p0x, p1x, p2x));
      const minY = ~~Math.max(0, Math.min(p0y, p1y, p2y));
      const maxX = ~~Math.min(width - 1, Math.max(p0x, p1x, p2x));
      const maxY = ~~Math.min(height - 1, Math.max(p0y, p1y, p2y));
      if (minX > maxX || minY > maxY) continue;

      for (let band = this.rowBand[minY]; band <= this.rowBand[maxY]; band++) {
        bins[band].push(i);
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
    const { shadowMap, shadowBuffer } = this;
    const shader = this.depthShader;
    shadowMap.clear(1000);
    shader.uniforms = { model, clipMat };
    for (let i = 0; i < model.vertices.length; i += 3) {
      for (let j = 0; j < 3; j++) {
        shader.vertexId = i + j;
        shader.nthVert = j;
        this.triVerts[j] = shader.vertex().perspectiveDivide();
      }
      triangle(this.triVerts, shader, shadowBuffer, shadowMap);
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
