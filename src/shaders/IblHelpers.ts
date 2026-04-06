import { Texture } from "../drawing";
import { Vector3 } from "../maths";
import { EPSILON, INV_PI } from "./pbrHelpers";

export interface IblData {
  diffuseIrradianceMap: Float32Array;
  diffuseIrradianceMapWidth: number;
  diffuseIrradianceMapHeight: number;
  specularPrefilterMap: Float32Array;
  specularPrefilterMapWidth: number;
  specularPrefilterMapHeight: number;
  specularPrefilterLayerStride: number;
  specularPrefilterRoughnessLutSize: number;
  specularPrefilterRoughnessMaxIndex: number;
  specularBrdfLut: Float32Array;
  specularBrdfLutSize: number;
  specularBrdfLutMaxIndex: number;
}

export const TAU = Math.PI * 2;
export const INV_TAU = 1 / TAU;
const diffuseIrradianceMapWidth = 32;
const diffuseIrradianceMapHeight = 16;
const diffuseIrradianceThetaSamples = 16;
const diffuseIrradiancePhiSamples = 32;
const specularPrefilterMapWidth = 64;
const specularPrefilterMapHeight = 32;
const specularPrefilterRoughnessLutSize = 32;
const specularPrefilterSampleCount = 64;
const specularBrdfLutSize = 128;
const specularBrdfSampleCount = 96;
const SUN_LUMINANCE_THRESHOLD = 0.98;

const clampSignedUnit = (value: number) => {
  return Math.max(-1, Math.min(1, value));
};

export const wrapUnit = (value: number) => {
  return value - Math.floor(value);
};

export const sampleLatLongMapInto = (
  data: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
  out: Vector3,
  layerIndex = 0,
  layerStride = width * height * 3,
) => {
  const xIndex = Math.max(
    0,
    Math.min(width - 1, Math.round(wrapUnit(u) * (width - 1))),
  );
  const yIndex = Math.max(
    0,
    Math.min(height - 1, Math.round(v * (height - 1))),
  );
  const layerOffset = layerIndex * layerStride;
  const base = layerOffset + (yIndex * width + xIndex) * 3;
  out.x = data[base];
  out.y = data[base + 1];
  out.z = data[base + 2];
  return out;
};

const directionToLatLongUv = (x: number, y: number, z: number) => {
  return {
    u: wrapUnit(Math.atan2(x, z) * INV_TAU + 0.5),
    v: Math.acos(clampSignedUnit(y)) * INV_PI,
  };
};

const latLongUvToDirection = (u: number, v: number) => {
  const phi = (u - 0.5) * TAU;
  const theta = v * Math.PI;
  const sinTheta = Math.sin(theta);

  return {
    x: Math.sin(phi) * sinTheta,
    y: Math.cos(theta),
    z: Math.cos(phi) * sinTheta,
  };
};

const buildBasis = (nx: number, ny: number, nz: number) => {
  let tx = 1;
  let ty = 0;
  let tz = 0;

  if (Math.abs(ny) < 0.999) {
    const tangentScale = 1 / Math.sqrt(nx * nx + nz * nz);
    tx = nz * tangentScale;
    ty = 0;
    tz = -nx * tangentScale;
  }

  return {
    tx,
    ty,
    tz,
    bx: ny * tz - nz * ty,
    by: nz * tx - nx * tz,
    bz: nx * ty - ny * tx,
  };
};

const sampleLatLongData = (
  data: Float32Array,
  width: number,
  height: number,
  u: number,
  v: number,
) => {
  const xCoord = wrapUnit(u) * width - 0.5;
  const yCoord = Math.max(0, Math.min(height - 1, v * height - 0.5));
  const x0 = Math.floor(xCoord);
  const y0 = Math.floor(yCoord);
  const xBlend = xCoord - x0;
  const yBlend = yCoord - y0;
  const xIndex0 = ((x0 % width) + width) % width;
  const xIndex1 = (xIndex0 + 1) % width;
  const yIndex0 = Math.max(0, Math.min(height - 1, y0));
  const yIndex1 = Math.min(yIndex0 + 1, height - 1);
  const rowStride = width * 3;
  const base00 = yIndex0 * rowStride + xIndex0 * 3;
  const base10 = yIndex0 * rowStride + xIndex1 * 3;
  const base01 = yIndex1 * rowStride + xIndex0 * 3;
  const base11 = yIndex1 * rowStride + xIndex1 * 3;
  const r0 = data[base00] + (data[base10] - data[base00]) * xBlend;
  const r1 = data[base01] + (data[base11] - data[base01]) * xBlend;
  const g0 = data[base00 + 1] + (data[base10 + 1] - data[base00 + 1]) * xBlend;
  const g1 = data[base01 + 1] + (data[base11 + 1] - data[base01 + 1]) * xBlend;
  const b0 = data[base00 + 2] + (data[base10 + 2] - data[base00 + 2]) * xBlend;
  const b1 = data[base01 + 2] + (data[base11 + 2] - data[base01 + 2]) * xBlend;

  return {
    r: r0 + (r1 - r0) * yBlend,
    g: g0 + (g1 - g0) * yBlend,
    b: b0 + (b1 - b0) * yBlend,
  };
};

const sampleEnvironment = (
  texture: Texture,
  x: number,
  y: number,
  z: number,
) => {
  const uv = directionToLatLongUv(x, y, z);
  return sampleLatLongData(
    texture.data,
    texture.width,
    texture.height,
    uv.u,
    uv.v,
  );
};

const wrapAngle = (angle: number) => {
  while (angle <= -Math.PI) {
    angle += TAU;
  }

  while (angle > Math.PI) {
    angle -= TAU;
  }

  return angle;
};

const directionToYaw = (direction: Vector3) => {
  return Math.atan2(direction.x, direction.z);
};

export const estimateEnvironmentSunDirection = (texture: Texture) => {
  let maxLuminance = 0;

  for (let i = 0; i < texture.data.length; i += 3) {
    const luminance =
      texture.data[i] * 0.2126 +
      texture.data[i + 1] * 0.7152 +
      texture.data[i + 2] * 0.0722;
    maxLuminance = Math.max(maxLuminance, luminance);
  }

  if (maxLuminance <= 0) {
    return Vector3.Forward;
  }

  const luminanceThreshold = maxLuminance * SUN_LUMINANCE_THRESHOLD;
  let sunX = 0;
  let sunY = 0;
  let sunZ = 0;
  let totalWeight = 0;

  for (let y = 0; y < texture.height; y++) {
    const v = (y + 0.5) / texture.height;
    const theta = v * Math.PI;
    const sinTheta = Math.sin(theta);
    const dirY = Math.cos(theta);

    for (let x = 0; x < texture.width; x++) {
      const base = (y * texture.width + x) * 3;
      const luminance =
        texture.data[base] * 0.2126 +
        texture.data[base + 1] * 0.7152 +
        texture.data[base + 2] * 0.0722;
      if (luminance < luminanceThreshold) {
        continue;
      }

      const u = (x + 0.5) / texture.width;
      const phi = (u - 0.5) * TAU;
      const weight = luminance * luminance * Math.max(sinTheta, 0.001);

      sunX += Math.sin(phi) * sinTheta * weight;
      sunY += dirY * weight;
      sunZ += Math.cos(phi) * sinTheta * weight;
      totalWeight += weight;
    }
  }

  if (totalWeight <= 0) {
    return Vector3.Forward;
  }

  return new Vector3(
    sunX / totalWeight,
    sunY / totalWeight,
    sunZ / totalWeight,
  ).normalize();
};

export const estimateEnvironmentYaw = (texture: Texture, lightDir: Vector3) => {
  const sunDirection = estimateEnvironmentSunDirection(texture);
  const lightDirectionToSource = lightDir.scale(-1);
  const sunLengthSq =
    sunDirection.x * sunDirection.x + sunDirection.z * sunDirection.z;
  const lightLengthSq =
    lightDirectionToSource.x * lightDirectionToSource.x +
    lightDirectionToSource.z * lightDirectionToSource.z;

  if (sunLengthSq <= Number.EPSILON || lightLengthSq <= Number.EPSILON) {
    return 0;
  }

  return wrapAngle(
    directionToYaw(lightDirectionToSource) - directionToYaw(sunDirection),
  );
};

const radicalInverseVdc = (bits: number) => {
  let value = bits >>> 0;
  value = ((value << 16) | (value >>> 16)) >>> 0;
  value = (((value & 0x55555555) << 1) | ((value & 0xaaaaaaaa) >>> 1)) >>> 0;
  value = (((value & 0x33333333) << 2) | ((value & 0xcccccccc) >>> 2)) >>> 0;
  value = (((value & 0x0f0f0f0f) << 4) | ((value & 0xf0f0f0f0) >>> 4)) >>> 0;
  value = (((value & 0x00ff00ff) << 8) | ((value & 0xff00ff00) >>> 8)) >>> 0;
  return value * 2.3283064365386963e-10;
};

const geometrySchlickGGXIbl = (nDotX: number, roughness: number) => {
  const k = roughness * roughness * 0.5;
  return nDotX / Math.max(nDotX * (1 - k) + k, EPSILON);
};

const geometrySmithIbl = (nDotV: number, nDotL: number, roughness: number) => {
  return (
    geometrySchlickGGXIbl(nDotV, roughness) *
    geometrySchlickGGXIbl(nDotL, roughness)
  );
};

const buildDiffuseIrradianceLut = (
  texture: Texture,
  width: number,
  height: number,
  thetaSamples: number,
  phiSamples: number,
) => {
  const map = new Float32Array(width * height * 3);
  const thetaStep = (Math.PI * 0.5) / thetaSamples;
  const phiStep = (Math.PI * 2) / phiSamples;

  for (let y = 0; y < height; y++) {
    const v = (y + 0.5) / height;
    for (let x = 0; x < width; x++) {
      const u = (x + 0.5) / width;
      const normal = latLongUvToDirection(u, v);
      const basis = buildBasis(normal.x, normal.y, normal.z);

      let irradianceR = 0;
      let irradianceG = 0;
      let irradianceB = 0;
      for (let thetaIndex = 0; thetaIndex < thetaSamples; thetaIndex++) {
        const theta = (thetaIndex + 0.5) * thetaStep;
        const sinTheta = Math.sin(theta);
        const cosTheta = Math.cos(theta);
        const sampleWeight = cosTheta * sinTheta * thetaStep * phiStep * INV_PI;

        for (let phiIndex = 0; phiIndex < phiSamples; phiIndex++) {
          const phi = (phiIndex + 0.5) * phiStep;
          const sinThetaCosPhi = sinTheta * Math.cos(phi);
          const sinThetaSinPhi = sinTheta * Math.sin(phi);
          const sampleX =
            basis.tx * sinThetaCosPhi +
            basis.bx * sinThetaSinPhi +
            normal.x * cosTheta;
          const sampleY =
            basis.ty * sinThetaCosPhi +
            basis.by * sinThetaSinPhi +
            normal.y * cosTheta;
          const sampleZ =
            basis.tz * sinThetaCosPhi +
            basis.bz * sinThetaSinPhi +
            normal.z * cosTheta;
          const sample = sampleEnvironment(texture, sampleX, sampleY, sampleZ);
          irradianceR += sample.r * sampleWeight;
          irradianceG += sample.g * sampleWeight;
          irradianceB += sample.b * sampleWeight;
        }
      }

      const base = (y * width + x) * 3;
      map[base] = irradianceR;
      map[base + 1] = irradianceG;
      map[base + 2] = irradianceB;
    }
  }

  return map;
};

const buildSpecularPrefilterLut = (
  texture: Texture,
  width: number,
  height: number,
  roughnessLutSize: number,
  sampleCount: number,
) => {
  const map = new Float32Array(width * height * roughnessLutSize * 3);

  for (
    let roughnessIndex = 0;
    roughnessIndex < roughnessLutSize;
    roughnessIndex++
  ) {
    const roughness = Math.max(0.045, roughnessIndex / (roughnessLutSize - 1));
    const alpha = roughness * roughness;
    const alphaSq = alpha * alpha;

    for (let y = 0; y < height; y++) {
      const v = (y + 0.5) / height;
      for (let x = 0; x < width; x++) {
        const u = (x + 0.5) / width;
        const reflection = latLongUvToDirection(u, v);
        const basis = buildBasis(reflection.x, reflection.y, reflection.z);

        let prefilteredR = 0;
        let prefilteredG = 0;
        let prefilteredB = 0;
        let totalWeight = 0;

        for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
          const xiX = sampleIndex / sampleCount;
          const xiY = radicalInverseVdc(sampleIndex);
          const phi = Math.PI * 2 * xiX;
          const cosTheta = Math.sqrt(
            (1 - xiY) / Math.max(1 + (alphaSq - 1) * xiY, EPSILON),
          );
          const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
          const hLocalX = Math.cos(phi) * sinTheta;
          const hLocalY = Math.sin(phi) * sinTheta;
          const hx =
            basis.tx * hLocalX + basis.bx * hLocalY + reflection.x * cosTheta;
          const hy =
            basis.ty * hLocalX + basis.by * hLocalY + reflection.y * cosTheta;
          const hz =
            basis.tz * hLocalX + basis.bz * hLocalY + reflection.z * cosTheta;
          const vDotH = Math.max(
            reflection.x * hx + reflection.y * hy + reflection.z * hz,
            0,
          );
          const lx = 2 * vDotH * hx - reflection.x;
          const ly = 2 * vDotH * hy - reflection.y;
          const lz = 2 * vDotH * hz - reflection.z;
          const nDotL = Math.max(
            reflection.x * lx + reflection.y * ly + reflection.z * lz,
            0,
          );
          if (nDotL <= 0) {
            continue;
          }

          const sample = sampleEnvironment(texture, lx, ly, lz);
          prefilteredR += sample.r * nDotL;
          prefilteredG += sample.g * nDotL;
          prefilteredB += sample.b * nDotL;
          totalWeight += nDotL;
        }

        const base = ((roughnessIndex * height + y) * width + x) * 3;
        const weightScale = totalWeight > 0 ? 1 / totalWeight : 0;
        map[base] = prefilteredR * weightScale;
        map[base + 1] = prefilteredG * weightScale;
        map[base + 2] = prefilteredB * weightScale;
      }
    }
  }

  return map;
};

const buildSpecularBrdfLut = (lutSize: number, sampleCount: number) => {
  const lut = new Float32Array(lutSize * lutSize * 2);

  for (let roughnessIndex = 0; roughnessIndex < lutSize; roughnessIndex++) {
    const roughness = Math.max(0.045, roughnessIndex / (lutSize - 1));
    const alpha = roughness * roughness;
    const alphaSq = alpha * alpha;

    for (let viewIndex = 0; viewIndex < lutSize; viewIndex++) {
      const nDotV = Math.max(0.0001, viewIndex / (lutSize - 1));
      const vx = Math.sqrt(Math.max(0, 1 - nDotV * nDotV));
      const vz = nDotV;
      let brdfA = 0;
      let brdfB = 0;

      for (let sampleIndex = 0; sampleIndex < sampleCount; sampleIndex++) {
        const xiX = sampleIndex / sampleCount;
        const xiY = radicalInverseVdc(sampleIndex);
        const phi = Math.PI * 2 * xiX;
        const cosTheta = Math.sqrt(
          (1 - xiY) / Math.max(1 + (alphaSq - 1) * xiY, EPSILON),
        );
        const sinTheta = Math.sqrt(Math.max(0, 1 - cosTheta * cosTheta));
        const hx = Math.cos(phi) * sinTheta;
        const hz = cosTheta;
        const vDotH = Math.max(vx * hx + vz * hz, 0);
        const lz = 2 * vDotH * hz - vz;
        const nDotL = Math.max(lz, 0);
        const nDotH = Math.max(hz, 0);
        if (nDotL <= 0) {
          continue;
        }

        const geometry = geometrySmithIbl(nDotV, nDotL, roughness);
        const visibility =
          (geometry * vDotH) / Math.max(nDotH * nDotV, EPSILON);
        const fresnel = Math.pow(1 - vDotH, 5);
        brdfA += (1 - fresnel) * visibility;
        brdfB += fresnel * visibility;
      }

      const base = (roughnessIndex * lutSize + viewIndex) * 2;
      const sampleScale = 1 / sampleCount;
      lut[base] = brdfA * sampleScale;
      lut[base + 1] = brdfB * sampleScale;
    }
  }

  return lut;
};

export const buildEnvironmentIbl = (environmentTexture: Texture): IblData => {
  return {
    diffuseIrradianceMap: buildDiffuseIrradianceLut(
      environmentTexture,
      diffuseIrradianceMapWidth,
      diffuseIrradianceMapHeight,
      diffuseIrradianceThetaSamples,
      diffuseIrradiancePhiSamples,
    ),
    specularPrefilterMap: buildSpecularPrefilterLut(
      environmentTexture,
      specularPrefilterMapWidth,
      specularPrefilterMapHeight,
      specularPrefilterRoughnessLutSize,
      specularPrefilterSampleCount,
    ),
    specularBrdfLut: buildSpecularBrdfLut(
      specularBrdfLutSize,
      specularBrdfSampleCount,
    ),
    diffuseIrradianceMapWidth,
    diffuseIrradianceMapHeight,
    specularPrefilterMapWidth,
    specularPrefilterMapHeight,
    specularPrefilterLayerStride:
      specularPrefilterMapWidth * specularPrefilterMapHeight * 3,
    specularPrefilterRoughnessLutSize,
    specularPrefilterRoughnessMaxIndex: specularPrefilterRoughnessLutSize - 1,
    specularBrdfLutSize,
    specularBrdfLutMaxIndex: specularBrdfLutSize - 1,
  };
};
