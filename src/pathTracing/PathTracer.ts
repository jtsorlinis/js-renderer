import { Framebuffer, Texture } from "../drawing";
import { linearToSrgb } from "../drawing/Texture";
import { Matrix4, Vector2, Vector3 } from "../maths";
import { PathTraceBvh } from "./pathTracingBvh";
import { PathTraceEnvironmentSampler } from "./pathTracingEnvironment";
import {
  applyNormalMap,
  buildBasis,
  createCameraRay,
  sampleEnvironment,
  sampleTexture,
} from "./pathTracingHelpers";
import { DIELECTRIC_F0, EPSILON, saturate } from "../shaders/pbrHelpers";
import {
  evaluateBsdf,
  evaluateDirectEnvironmentLighting,
  evaluateDirectSunLighting,
  getSpecularSamplingProbability,
} from "./pathTracingLighting";
import { type PbrMaterial } from "../utils/modelLoader";
import { type LoadedModel } from "../utils/objLoader";

const RAY_EPSILON = 0.001;

const lightIntensity = 1.88;
const environmentIntensity = 0.6;
const maxBounces = 4;
const rouletteBounces = 3;
const renderEnvironment = false;

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

export class PathTracer {
  private bvh = new PathTraceBvh();
  private accumulation = new Float32Array(0);
  private environmentSampler = new PathTraceEnvironmentSampler();
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

  render = (
    target: Framebuffer,
    scene: PathTraceScene,
    camera: PathTraceCamera,
    timeBudgetMs: number,
  ) => {
    if (this.bvh.ensureGeometry(scene.model)) {
      this.needsReset = true;
    }
    if (this.environmentSampler.ensureSampling(scene.environment)) {
      this.needsReset = true;
    }
    this.ensureResolution(target.width, target.height);
    this.syncAccumulationState(scene, camera);
    this.resetIfNeeded();

    const totalPixels = this.internalWidth * this.internalHeight;
    const deadline = performance.now() + timeBudgetMs;
    let processedPixels = 0;

    while (
      totalPixels > 0 &&
      (processedPixels === 0 || performance.now() < deadline)
    ) {
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

    return totalPixels ? this.sampleCount + this.workIndex / totalPixels : 0;
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

  private ensureResolution = (targetWidth: number, targetHeight: number) => {
    const width = Math.max(1, targetWidth);
    const height = Math.max(1, targetHeight);
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
    let throughputR = 1;
    let throughputG = 1;
    let throughputB = 1;
    let radianceR = 0;
    let radianceG = 0;
    let radianceB = 0;
    let lastBsdfPdf = 0;
    let hasSampledBsdf = false;

    for (let bounce = 0; bounce < maxBounces; bounce++) {
      const hit = this.traceClosest(origin, direction, scene);
      if (!hit) {
        if (bounce > 0 || renderEnvironment) {
          const environment = sampleEnvironment(
            scene.environment,
            scene.envYawCos,
            scene.envYawSin,
            direction,
          ).scale(environmentIntensity);
          const environmentPdf = hasSampledBsdf
            ? this.environmentSampler.directionPdf(
                scene.environment,
                scene.envYawCos,
                scene.envYawSin,
                direction,
              )
            : 0;
          const environmentWeight =
            hasSampledBsdf && environmentPdf > 0
              ? this.powerHeuristic(lastBsdfPdf, environmentPdf)
              : 1;
          radianceR += throughputR * environment.x * environmentWeight;
          radianceG += throughputG * environment.y * environmentWeight;
          radianceB += throughputB * environment.z * environmentWeight;
        }
        break;
      }

      const viewDir = direction.scale(-1).normalize();
      const specularChance = getSpecularSamplingProbability(hit, viewDir);
      const directLight = this.evaluateDirectSun(hit, viewDir, scene);
      const directEnvironment = this.evaluateDirectEnvironment(
        hit,
        viewDir,
        specularChance,
        scene,
      );
      radianceR += throughputR * directLight.x;
      radianceR += throughputR * directEnvironment.x;
      radianceG += throughputG * directLight.y;
      radianceG += throughputG * directEnvironment.y;
      radianceB += throughputB * directLight.z;
      radianceB += throughputB * directEnvironment.z;

      if (bounce === maxBounces - 1) {
        break;
      }

      let nextDirection: Vector3;
      if (this.nextRandom() < specularChance) {
        nextDirection = this.sampleSpecularDirection(
          hit.shadingNormal,
          direction,
          hit.roughness,
        );
      } else {
        nextDirection = this.sampleDiffuseDirection(hit.shadingNormal);
      }

      const bsdf = evaluateBsdf(hit, viewDir, nextDirection, specularChance);
      if (bsdf.nDotL <= 0 || bsdf.pdf <= 0) {
        break;
      }
      const throughputScale = bsdf.nDotL / bsdf.pdf;
      throughputR *= bsdf.value.x * throughputScale;
      throughputG *= bsdf.value.y * throughputScale;
      throughputB *= bsdf.value.z * throughputScale;
      lastBsdfPdf = bsdf.pdf;
      hasSampledBsdf = true;

      if (bounce + 1 >= rouletteBounces) {
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
    const contribution = evaluateDirectSunLighting(
      hit,
      viewDir,
      lightDir,
      scene.lightColor,
      lightIntensity,
    );
    if (contribution.lengthSq() <= 0) {
      return Vector3.Zero;
    }

    const shadowOrigin = hit.position.add(
      hit.geometricNormal.scale(RAY_EPSILON),
    );
    if (this.traceAny(shadowOrigin, lightDir, scene)) {
      return Vector3.Zero;
    }

    return contribution;
  };

  private evaluateDirectEnvironment = (
    hit: HitRecord,
    viewDir: Vector3,
    specularChance: number,
    scene: PathTraceScene,
  ) => {
    const environmentSample = this.environmentSampler.sampleLight(
      scene.environment,
      scene.envYawCos,
      scene.envYawSin,
      this.nextRandom,
    );
    if (!environmentSample) {
      return Vector3.Zero;
    }

    const contribution = evaluateDirectEnvironmentLighting(
      hit,
      viewDir,
      environmentSample.direction,
      environmentSample.radiance,
      environmentSample.pdf,
      environmentIntensity,
      specularChance,
    );
    if (contribution.lengthSq() <= 0) {
      return Vector3.Zero;
    }

    const shadowOrigin = hit.position.add(
      hit.geometricNormal.scale(RAY_EPSILON),
    );
    if (this.traceAny(shadowOrigin, environmentSample.direction, scene)) {
      return Vector3.Zero;
    }

    return contribution;
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
    const hasUvs = scene.model.uvs.length === scene.model.vertices.length;
    const hasTangents =
      scene.model.tangents.length === scene.model.vertices.length;

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
    if (hasUvs) {
      const uv0 = scene.model.uvs[vertexOffset];
      const uv1 = scene.model.uvs[vertexOffset + 1];
      const uv2 = scene.model.uvs[vertexOffset + 2];
      uv = new Vector2(
        uv0.x * baryW + uv1.x * hit.baryU + uv2.x * hit.baryV,
        uv0.y * baryW + uv1.y * hit.baryU + uv2.y * hit.baryV,
      );
    }

    if (hasTangents && hasUvs) {
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

    const sampledBaseColor = hasUvs
      ? sampleTexture(scene.texture, uv)
      : Vector3.One;
    const baseColor = sampledBaseColor.multiplyInPlace(
      scene.pbrMaterial.baseColorFactor,
    );
    const metallicRoughness = hasUvs
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

  private present = (target: Framebuffer) => {
    const targetData = target.data;

    for (
      let pixelIndex = 0;
      pixelIndex < this.pixelSampleCounts.length;
      pixelIndex++
    ) {
      const sourceIndex = pixelIndex * 3;
      const targetIndex = pixelIndex * 4;
      const sampleScale =
        this.pixelSampleCounts[pixelIndex] > 0
          ? 1 / this.pixelSampleCounts[pixelIndex]
          : 0;
      targetData[targetIndex] =
        linearToSrgb(this.accumulation[sourceIndex] * sampleScale) * 255;
      targetData[targetIndex + 1] =
        linearToSrgb(this.accumulation[sourceIndex + 1] * sampleScale) * 255;
      targetData[targetIndex + 2] =
        linearToSrgb(this.accumulation[sourceIndex + 2] * sampleScale) * 255;
      targetData[targetIndex + 3] = 255;
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

    return Math.abs(a - b) > 0.0001;
  };

  private powerHeuristic = (a: number, b: number) => {
    const a2 = a * a;
    const b2 = b * b;
    return a2 / Math.max(a2 + b2, EPSILON);
  };
}
