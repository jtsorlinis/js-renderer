import { Framebuffer, Texture } from "../drawing";
import { linearChannelToSrgb } from "../drawing/Texture";
import { Matrix4, Vector2, Vector3 } from "../maths";
import { PathTraceBvh } from "./pathTracingBvh";
import {
  applyNormalMap,
  buildBasis,
  createCameraRay,
  environmentUvToDirection,
  sampleEnvironment,
  sampleTexture,
} from "./pathTracingHelpers";
import {
  DIELECTRIC_F0,
  EPSILON,
  INV_PI,
  distributionGGX,
  fresnelSchlick,
  geometrySmith,
  saturate,
} from "../shaders/pbrHelpers";
import { type PbrMaterial } from "../utils/modelLoader";
import { type LoadedModel } from "../utils/objLoader";

const PREVIEW_RESOLUTION_SCALE = 0.25;
const IDLE_RESOLUTION_SCALE = 1;
const MAX_BOUNCES = 4;
const RUSSIAN_ROULETTE_BOUNCE = 3;
const RAY_EPSILON = 0.001;
const RENDER_ENVIRONMENT = false;
const RESET_EPSILON = 0.0001;
const SUN_INTENSITY = 3.14;
const ENVIRONMENT_PDF_EPSILON = 0.000001;

interface EnvironmentLightSample {
  direction: Vector3;
  pdf: number;
  radiance: Vector3;
}

interface HitRecord {
  baseColor: Vector3;
  f0: Vector3;
  geometricNormal: Vector3;
  position: Vector3;
  roughness: number;
  shadingNormal: Vector3;
  metallic: number;
}

export interface PathTraceScene {
  environment: Texture;
  envYawCos: number;
  envYawSin: number;
  lightColor: Vector3;
  lightDirectionToLight: Vector3;
  model: LoadedModel;
  modelMat: Matrix4;
  invModelMat: Matrix4;
  normalMat: Matrix4;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
  texture: Texture;
}

export interface PathTraceCamera {
  aspectRatio: number;
  cameraOrthoSize: number;
  orthographic: boolean;
  position: Vector3;
}

export interface PathTraceFrameInfo {
  internalHeight: number;
  internalWidth: number;
  preview: boolean;
  sampleCount: number;
}

export class PathTracer {
  private bvh = new PathTraceBvh();
  private accumulation = new Float32Array(0);
  private environmentCdf = new Float32Array(0);
  private environmentWeightTotal = 0;
  private pixelSampleCounts = new Uint32Array(0);
  private internalWidth = 0;
  private internalHeight = 0;
  private sampleCount = 0;
  private workIndex = 0;
  private needsReset = true;
  private randomState = 1;
  private lastAspectRatio = Number.NaN;
  private lastCameraOrthoSize = Number.NaN;
  private lastOrthographic = false;
  private lastCameraPosition = new Vector3(Number.NaN, Number.NaN, Number.NaN);
  private lastModelMatrix = new Float32Array(16).fill(Number.NaN);
  private sampledEnvironment: Texture | null = null;

  render = (
    target: Framebuffer,
    scene: PathTraceScene,
    camera: PathTraceCamera,
    preview: boolean,
    timeBudgetMs: number,
  ): PathTraceFrameInfo => {
    if (this.bvh.ensureGeometry(scene.model)) {
      this.needsReset = true;
    }
    this.ensureEnvironmentSampling(scene.environment);
    this.ensureResolution(target.width, target.height, preview);
    this.syncAccumulationState(scene, camera);
    this.resetIfNeeded();

    const totalPixels = this.internalWidth * this.internalHeight;
    const startWorkIndex = this.workIndex;
    const deadline = performance.now() + timeBudgetMs;
    let processedPixels = 0;

    while (totalPixels > 0) {
      if (processedPixels > 0) {
        if (preview) {
          if (this.workIndex === startWorkIndex) {
            break;
          }
        } else if (performance.now() >= deadline) {
          break;
        }
      }

      const pixelIndex = this.workIndex;
      const x = pixelIndex % this.internalWidth;
      const y = Math.floor(pixelIndex / this.internalWidth);
      const nextPixelSampleCount = this.pixelSampleCounts[pixelIndex] + 1;
      this.seedRandom(pixelIndex, nextPixelSampleCount);
      const colour = this.tracePixel(x, y, scene, camera);
      const accumulationIndex = pixelIndex * 3;
      this.accumulation[accumulationIndex] += colour.x;
      this.accumulation[accumulationIndex + 1] += colour.y;
      this.accumulation[accumulationIndex + 2] += colour.z;
      this.pixelSampleCounts[pixelIndex] = nextPixelSampleCount;
      this.workIndex++;
      processedPixels++;

      if (this.workIndex >= totalPixels) {
        this.workIndex = 0;
        this.sampleCount++;
      }
    }

    this.present(target);

    return {
      internalHeight: this.internalHeight,
      internalWidth: this.internalWidth,
      preview,
      sampleCount: totalPixels
        ? this.sampleCount + this.workIndex / totalPixels
        : 0,
    };
  };

  private syncAccumulationState = (
    scene: PathTraceScene,
    camera: PathTraceCamera,
  ) => {
    const modelMatrix = scene.modelMat.m;
    let stateChanged =
      camera.orthographic !== this.lastOrthographic ||
      this.differs(camera.aspectRatio, this.lastAspectRatio) ||
      this.differs(camera.cameraOrthoSize, this.lastCameraOrthoSize) ||
      this.differs(camera.position.x, this.lastCameraPosition.x) ||
      this.differs(camera.position.y, this.lastCameraPosition.y) ||
      this.differs(camera.position.z, this.lastCameraPosition.z);

    if (!stateChanged) {
      for (let i = 0; i < modelMatrix.length; i++) {
        if (this.differs(modelMatrix[i], this.lastModelMatrix[i])) {
          stateChanged = true;
          break;
        }
      }
    }

    if (!stateChanged) {
      return;
    }

    this.needsReset = true;
    this.lastOrthographic = camera.orthographic;
    this.lastAspectRatio = camera.aspectRatio;
    this.lastCameraOrthoSize = camera.cameraOrthoSize;
    this.lastCameraPosition.x = camera.position.x;
    this.lastCameraPosition.y = camera.position.y;
    this.lastCameraPosition.z = camera.position.z;
    this.lastModelMatrix.set(modelMatrix);
  };

  private ensureResolution = (
    targetWidth: number,
    targetHeight: number,
    preview: boolean,
  ) => {
    const resolutionScale = preview
      ? PREVIEW_RESOLUTION_SCALE
      : IDLE_RESOLUTION_SCALE;
    const width = Math.max(1, Math.floor(targetWidth * resolutionScale));
    const height = Math.max(1, Math.floor(targetHeight * resolutionScale));
    if (width === this.internalWidth && height === this.internalHeight) {
      return;
    }

    this.internalWidth = width;
    this.internalHeight = height;
    this.accumulation = new Float32Array(width * height * 3);
    this.pixelSampleCounts = new Uint32Array(width * height);
    this.needsReset = true;
  };

  private resetIfNeeded = () => {
    if (!this.needsReset) {
      return;
    }

    this.accumulation.fill(0);
    this.pixelSampleCounts.fill(0);
    this.sampleCount = 0;
    this.workIndex = 0;
    this.needsReset = false;
  };

  private tracePixel = (
    x: number,
    y: number,
    scene: PathTraceScene,
    camera: PathTraceCamera,
  ) => {
    const jitterX = this.nextRandom();
    const jitterY = this.nextRandom();
    const ndcX = ((x + jitterX) / this.internalWidth) * 2 - 1;
    const ndcY = 1 - ((y + jitterY) / this.internalHeight) * 2;
    const { origin, direction } = createCameraRay(
      ndcX,
      ndcY,
      camera.position,
      camera.aspectRatio,
      camera.cameraOrthoSize,
      camera.orthographic,
    );

    return this.traceRadiance(origin, direction, scene);
  };

  private traceRadiance = (
    initialOrigin: Vector3,
    initialDirection: Vector3,
    scene: PathTraceScene,
  ) => {
    let origin = initialOrigin;
    let direction = initialDirection;
    let allowEnvironmentOnMiss = RENDER_ENVIRONMENT;
    let throughputR = 1;
    let throughputG = 1;
    let throughputB = 1;
    let radianceR = 0;
    let radianceG = 0;
    let radianceB = 0;

    for (let bounce = 0; bounce < MAX_BOUNCES; bounce++) {
      const hit = this.traceClosest(origin, direction, scene);
      if (!hit) {
        if (bounce > 0 ? allowEnvironmentOnMiss : RENDER_ENVIRONMENT) {
          const environment = sampleEnvironment(
            scene.environment,
            scene.envYawCos,
            scene.envYawSin,
            direction,
          );
          radianceR += throughputR * environment.x;
          radianceG += throughputG * environment.y;
          radianceB += throughputB * environment.z;
        }
        break;
      }

      const viewDir = direction.scale(-1).normalize();
      const directLight = this.evaluateDirectSun(hit, viewDir, scene);
      const directEnvironment = this.evaluateDirectEnvironment(hit, scene);
      radianceR += throughputR * directLight.x;
      radianceR += throughputR * directEnvironment.x;
      radianceG += throughputG * directLight.y;
      radianceG += throughputG * directEnvironment.y;
      radianceB += throughputB * directLight.z;
      radianceB += throughputB * directEnvironment.z;

      if (bounce === MAX_BOUNCES - 1) {
        break;
      }

      const cosTheta = saturate(hit.shadingNormal.dot(viewDir));
      const fresnel = fresnelSchlick(cosTheta, hit.f0);
      const fresnelAverage = (fresnel.x + fresnel.y + fresnel.z) / 3;
      const specularChance = Math.max(
        0.2,
        Math.min(0.85, fresnelAverage + hit.metallic * (1 - fresnelAverage)),
      );

      let nextDirection: Vector3;
      if (this.nextRandom() < specularChance) {
        nextDirection = this.sampleSpecularDirection(
          hit.shadingNormal,
          direction,
          hit.roughness,
        );
        throughputR *= fresnel.x / specularChance;
        throughputG *= fresnel.y / specularChance;
        throughputB *= fresnel.z / specularChance;
        allowEnvironmentOnMiss = true;
      } else {
        nextDirection = this.sampleDiffuseDirection(hit.shadingNormal);
        const diffuseScale = (1 - hit.metallic) / (1 - specularChance);
        throughputR *= hit.baseColor.x * diffuseScale;
        throughputG *= hit.baseColor.y * diffuseScale;
        throughputB *= hit.baseColor.z * diffuseScale;
        allowEnvironmentOnMiss = false;
      }

      if (bounce + 1 >= RUSSIAN_ROULETTE_BOUNCE) {
        const survivalProbability = Math.max(
          0.1,
          Math.min(0.95, Math.max(throughputR, throughputG, throughputB)),
        );
        if (this.nextRandom() > survivalProbability) {
          break;
        }

        throughputR /= survivalProbability;
        throughputG /= survivalProbability;
        throughputB /= survivalProbability;
      }

      origin = hit.position.add(hit.geometricNormal.scale(RAY_EPSILON));
      direction = nextDirection;
    }

    return new Vector3(radianceR, radianceG, radianceB);
  };

  private evaluateDirectSun = (
    hit: HitRecord,
    viewDir: Vector3,
    scene: PathTraceScene,
  ) => {
    const lightDir = scene.lightDirectionToLight;
    const nDotL = saturate(hit.shadingNormal.dot(lightDir));
    const nDotV = saturate(hit.shadingNormal.dot(viewDir));
    if (nDotL <= 0 || nDotV <= 0) {
      return Vector3.Zero;
    }

    const shadowOrigin = hit.position.add(
      hit.geometricNormal.scale(RAY_EPSILON),
    );
    if (this.traceAny(shadowOrigin, lightDir, scene)) {
      return Vector3.Zero;
    }

    const halfDir = lightDir.add(viewDir);
    if (halfDir.lengthSq() <= EPSILON) {
      return Vector3.Zero;
    }

    halfDir.normalize();
    const nDotH = saturate(hit.shadingNormal.dot(halfDir));
    const vDotH = saturate(viewDir.dot(halfDir));
    const fresnelFactor = Math.pow(1 - vDotH, 5);
    const fresnelX = hit.f0.x + (1 - hit.f0.x) * fresnelFactor;
    const fresnelY = hit.f0.y + (1 - hit.f0.y) * fresnelFactor;
    const fresnelZ = hit.f0.z + (1 - hit.f0.z) * fresnelFactor;
    const distribution = distributionGGX(nDotH, hit.roughness);
    const geometry = geometrySmith(nDotV, nDotL, hit.roughness);
    const specularFactor =
      (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
    const diffuseFactor = (1 - hit.metallic) * INV_PI;
    const lightScale = nDotL * SUN_INTENSITY;

    return new Vector3(
      ((1 - fresnelX) * diffuseFactor * hit.baseColor.x +
        fresnelX * specularFactor) *
        scene.lightColor.x *
        lightScale,
      ((1 - fresnelY) * diffuseFactor * hit.baseColor.y +
        fresnelY * specularFactor) *
        scene.lightColor.y *
        lightScale,
      ((1 - fresnelZ) * diffuseFactor * hit.baseColor.z +
        fresnelZ * specularFactor) *
        scene.lightColor.z *
        lightScale,
    );
  };

  private evaluateDirectEnvironment = (
    hit: HitRecord,
    scene: PathTraceScene,
  ) => {
    if (hit.metallic >= 1 || this.environmentWeightTotal <= 0) {
      return Vector3.Zero;
    }

    const environmentSample = this.sampleEnvironmentLight(
      scene.environment,
      scene.envYawCos,
      scene.envYawSin,
    );
    if (!environmentSample) {
      return Vector3.Zero;
    }

    const nDotL = saturate(hit.shadingNormal.dot(environmentSample.direction));
    if (nDotL <= 0) {
      return Vector3.Zero;
    }

    const shadowOrigin = hit.position.add(
      hit.geometricNormal.scale(RAY_EPSILON),
    );
    if (this.traceAny(shadowOrigin, environmentSample.direction, scene)) {
      return Vector3.Zero;
    }

    const diffuseScale =
      ((1 - hit.metallic) * INV_PI * nDotL) / environmentSample.pdf;
    return new Vector3(
      hit.baseColor.x * environmentSample.radiance.x * diffuseScale,
      hit.baseColor.y * environmentSample.radiance.y * diffuseScale,
      hit.baseColor.z * environmentSample.radiance.z * diffuseScale,
    );
  };

  private traceClosest = (
    originWorld: Vector3,
    directionWorld: Vector3,
    scene: PathTraceScene,
  ) => {
    const originModel = scene.invModelMat.transformPoint(originWorld);
    const directionModel = scene.invModelMat
      .transformDirection(directionWorld)
      .normalize();
    const hit = this.bvh.intersect(originModel, directionModel);
    if (!hit) {
      return undefined;
    }

    const vertexOffset = hit.triangleIndex * 3;
    const v0 = scene.model.vertices[vertexOffset];
    const v1 = scene.model.vertices[vertexOffset + 1];
    const v2 = scene.model.vertices[vertexOffset + 2];
    const baryW = 1 - hit.baryU - hit.baryV;
    const positionModel = new Vector3(
      v0.x * baryW + v1.x * hit.baryU + v2.x * hit.baryV,
      v0.y * baryW + v1.y * hit.baryU + v2.y * hit.baryV,
      v0.z * baryW + v1.z * hit.baryU + v2.z * hit.baryV,
    );
    const position = scene.modelMat.transformPoint(positionModel);

    const normal0 = scene.model.normals[vertexOffset];
    const normal1 = scene.model.normals[vertexOffset + 1];
    const normal2 = scene.model.normals[vertexOffset + 2];
    const smoothNormalModel = new Vector3(
      normal0.x * baryW + normal1.x * hit.baryU + normal2.x * hit.baryV,
      normal0.y * baryW + normal1.y * hit.baryU + normal2.y * hit.baryV,
      normal0.z * baryW + normal1.z * hit.baryU + normal2.z * hit.baryV,
    ).normalize();
    const geometricNormalModel = scene.model.faceNormals[vertexOffset];
    const geometricNormal = scene.normalMat
      .transformDirection(geometricNormalModel)
      .normalize();
    let shadingNormal = scene.normalMat
      .transformDirection(smoothNormalModel)
      .normalize();

    let uv = new Vector2(0, 0);
    if (scene.model.uvs.length === scene.model.vertices.length) {
      const uv0 = scene.model.uvs[vertexOffset];
      const uv1 = scene.model.uvs[vertexOffset + 1];
      const uv2 = scene.model.uvs[vertexOffset + 2];
      uv = new Vector2(
        uv0.x * baryW + uv1.x * hit.baryU + uv2.x * hit.baryV,
        uv0.y * baryW + uv1.y * hit.baryU + uv2.y * hit.baryV,
      );
    }

    if (
      scene.model.tangents.length === scene.model.vertices.length &&
      scene.model.uvs.length === scene.model.vertices.length
    ) {
      shadingNormal = applyNormalMap(
        shadingNormal,
        scene.model.tangents[vertexOffset],
        scene.model.tangents[vertexOffset + 1],
        scene.model.tangents[vertexOffset + 2],
        baryW,
        hit.baryU,
        hit.baryV,
        scene.modelMat,
        scene.normalTexture,
        uv,
      );
    }

    if (shadingNormal.dot(directionWorld) > 0) {
      shadingNormal = shadingNormal.scale(-1);
    }

    const orientedGeometricNormal =
      geometricNormal.dot(directionWorld) > 0
        ? geometricNormal.scale(-1)
        : geometricNormal;

    const sampledBaseColor =
      scene.model.uvs.length === scene.model.vertices.length
        ? sampleTexture(scene.texture, uv)
        : Vector3.One;
    const baseColor = sampledBaseColor.multiplyInPlace(
      scene.pbrMaterial.baseColorFactor,
    );
    const metallicRoughness =
      scene.model.uvs.length === scene.model.vertices.length
        ? sampleTexture(scene.pbrMaterial.metallicRoughnessTexture, uv)
        : Vector3.One;
    const roughness = Math.max(
      0.045,
      saturate(metallicRoughness.y * scene.pbrMaterial.roughnessFactor),
    );
    const metallic = saturate(
      metallicRoughness.z * scene.pbrMaterial.metallicFactor,
    );
    const f0 = new Vector3(
      DIELECTRIC_F0.x + (baseColor.x - DIELECTRIC_F0.x) * metallic,
      DIELECTRIC_F0.y + (baseColor.y - DIELECTRIC_F0.y) * metallic,
      DIELECTRIC_F0.z + (baseColor.z - DIELECTRIC_F0.z) * metallic,
    );

    return {
      baseColor,
      f0,
      geometricNormal: orientedGeometricNormal,
      metallic,
      position,
      roughness,
      shadingNormal,
    } satisfies HitRecord;
  };

  private sampleDiffuseDirection = (normal: Vector3) => {
    const r1 = this.nextRandom();
    const r2 = this.nextRandom();
    const phi = Math.PI * 2 * r1;
    const radius = Math.sqrt(r2);
    const localX = Math.cos(phi) * radius;
    const localY = Math.sin(phi) * radius;
    const localZ = Math.sqrt(Math.max(0, 1 - r2));
    const basis = buildBasis(normal);
    return basis.tangent
      .scale(localX)
      .add(basis.bitangent.scale(localY))
      .add(normal.scale(localZ))
      .normalize();
  };

  private sampleSpecularDirection = (
    normal: Vector3,
    incident: Vector3,
    roughness: number,
  ) => {
    const r1 = this.nextRandom();
    const r2 = this.nextRandom();
    const alpha = Math.max(0.02, roughness * roughness);
    const alphaSq = alpha * alpha;
    const phi = Math.PI * 2 * r1;
    const cosTheta = Math.sqrt(
      (1 - r2) / Math.max(1 + (alphaSq - 1) * r2, EPSILON),
    );
    const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
    const basis = buildBasis(normal);
    const halfVector = basis.tangent
      .scale(Math.cos(phi) * sinTheta)
      .add(basis.bitangent.scale(Math.sin(phi) * sinTheta))
      .add(normal.scale(cosTheta))
      .normalize();
    const reflected = incident.reflect(halfVector).normalize();
    return reflected.dot(normal) > 0
      ? reflected
      : incident.reflect(normal).normalize();
  };

  private traceAny = (
    originWorld: Vector3,
    directionWorld: Vector3,
    scene: PathTraceScene,
  ) => {
    const originModel = scene.invModelMat.transformPoint(originWorld);
    const directionModel = scene.invModelMat
      .transformDirection(directionWorld)
      .normalize();
    return this.bvh.intersect(originModel, directionModel, true) !== undefined;
  };

  private ensureEnvironmentSampling = (environment: Texture) => {
    if (this.sampledEnvironment === environment) {
      return;
    }

    this.sampledEnvironment = environment;
    this.needsReset = true;
    this.environmentCdf = new Float32Array(
      environment.width * environment.height,
    );
    this.environmentWeightTotal = 0;

    for (let y = 0; y < environment.height; y++) {
      const sinTheta = Math.sin(((y + 0.5) / environment.height) * Math.PI);
      for (let x = 0; x < environment.width; x++) {
        const weight =
          this.getEnvironmentTexelLuminance(environment, x, y) * sinTheta;
        this.environmentWeightTotal += weight;
        this.environmentCdf[x + y * environment.width] =
          this.environmentWeightTotal;
      }
    }
  };

  private sampleEnvironmentLight = (
    environment: Texture,
    envYawCos: number,
    envYawSin: number,
  ): EnvironmentLightSample | undefined => {
    if (this.environmentWeightTotal <= 0 || this.environmentCdf.length === 0) {
      return undefined;
    }

    const sampleIndex = this.sampleEnvironmentTexelIndex();
    const texelX = sampleIndex % environment.width;
    const texelY = Math.floor(sampleIndex / environment.width);
    const texelLuminance = this.getEnvironmentTexelLuminance(
      environment,
      texelX,
      texelY,
    );
    if (texelLuminance <= 0) {
      return undefined;
    }

    const u = (texelX + this.nextRandom()) / environment.width;
    const v = (texelY + this.nextRandom()) / environment.height;
    const direction = environmentUvToDirection(u, v, envYawCos, envYawSin);
    return {
      direction,
      pdf: Math.max(
        ENVIRONMENT_PDF_EPSILON,
        (texelLuminance * environment.width * environment.height) /
          (2 * Math.PI * Math.PI * this.environmentWeightTotal),
      ),
      radiance: sampleEnvironment(environment, envYawCos, envYawSin, direction),
    };
  };

  private sampleEnvironmentTexelIndex = () => {
    const target = this.nextRandom() * this.environmentWeightTotal;
    let low = 0;
    let high = this.environmentCdf.length - 1;
    while (low < high) {
      const mid = (low + high) >> 1;
      if (target <= this.environmentCdf[mid]) {
        high = mid;
      } else {
        low = mid + 1;
      }
    }

    return low;
  };

  private getEnvironmentTexelLuminance = (
    environment: Texture,
    x: number,
    y: number,
  ) => {
    const base = (x + y * environment.width) * 3;
    return (
      environment.data[base] * 0.2126 +
      environment.data[base + 1] * 0.7152 +
      environment.data[base + 2] * 0.0722
    );
  };

  private present = (target: Framebuffer) => {
    const targetData = target.data;

    for (let y = 0; y < target.height; y++) {
      const sourceY = Math.min(
        this.internalHeight - 1,
        Math.floor((y / target.height) * this.internalHeight),
      );
      for (let x = 0; x < target.width; x++) {
        const sourceX = Math.min(
          this.internalWidth - 1,
          Math.floor((x / target.width) * this.internalWidth),
        );
        const sourcePixelIndex = sourceX + sourceY * this.internalWidth;
        const sourceIndex = sourcePixelIndex * 3;
        const targetIndex = (x + y * target.width) * 4;
        const sampleScale =
          this.pixelSampleCounts[sourcePixelIndex] > 0
            ? 1 / this.pixelSampleCounts[sourcePixelIndex]
            : 0;
        targetData[targetIndex] =
          linearChannelToSrgb(this.accumulation[sourceIndex] * sampleScale) *
          255;
        targetData[targetIndex + 1] =
          linearChannelToSrgb(
            this.accumulation[sourceIndex + 1] * sampleScale,
          ) * 255;
        targetData[targetIndex + 2] =
          linearChannelToSrgb(
            this.accumulation[sourceIndex + 2] * sampleScale,
          ) * 255;
        targetData[targetIndex + 3] = 255;
      }
    }
  };

  private seedRandom = (pixelIndex: number, sampleCount: number) => {
    this.randomState =
      ((pixelIndex + 1) * 1973 + sampleCount * 9277 + 0x68bc21eb) >>> 0;
  };

  private nextRandom = () => {
    this.randomState ^= this.randomState << 13;
    this.randomState ^= this.randomState >>> 17;
    this.randomState ^= this.randomState << 5;
    return (this.randomState >>> 0) / 4294967296;
  };

  private differs = (a: number, b: number) => {
    if (Number.isNaN(a) || Number.isNaN(b)) {
      return true;
    }

    return Math.abs(a - b) > RESET_EPSILON;
  };
}
