import { Texture } from "../drawing";
import { EPSILON, INV_PI } from "./pbrHelpers";

export interface IblData {
  diffuseIrradianceLut: Float32Array;
  diffuseIrradianceLutSize: number;
  specularPrefilterLut: Float32Array;
  specularPrefilterUpLutSize: number;
  specularPrefilterRoughnessLutSize: number;
  specularBrdfLut: Float32Array;
  specularBrdfLutSize: number;
}

interface EnvironmentProfile {
  values: Float32Array;
  size: number;
}

const diffuseIrradianceLutSize = 64;
const diffuseIrradianceThetaSamples = 24;
const diffuseIrradiancePhiSamples = 48;
const specularPrefilterUpLutSize = 64;
const specularPrefilterRoughnessLutSize = 32;
const specularPrefilterSampleCount = 64;
const specularBrdfLutSize = 32;
const specularBrdfSampleCount = 96;

const clampSignedUnit = (value: number) => {
  return Math.max(-1, Math.min(1, value));
};

const buildEnvironmentProfile = (texture: Texture): EnvironmentProfile => {
  const values = new Float32Array(texture.height * 3);

  for (let y = 0; y < texture.height; y++) {
    const rowBase = y * texture.width * 3;
    let rowR = 0;
    let rowG = 0;
    let rowB = 0;

    for (let x = 0; x < texture.width; x++) {
      const base = rowBase + x * 3;
      rowR += texture.data[base];
      rowG += texture.data[base + 1];
      rowB += texture.data[base + 2];
    }

    const scale = 1 / texture.width;
    const outputBase = y * 3;
    values[outputBase] = rowR * scale;
    values[outputBase + 1] = rowG * scale;
    values[outputBase + 2] = rowB * scale;
  }

  return { values, size: texture.height };
};

const sampleProfile = (profile: EnvironmentProfile, up: number) => {
  const coord = (Math.acos(clampSignedUnit(up)) / Math.PI) * (profile.size - 1);
  const index = Math.floor(coord);
  const next = Math.min(index + 1, profile.size - 1);
  const blend = coord - index;
  const base = index * 3;
  const nextBase = next * 3;

  return {
    r:
      profile.values[base] +
      (profile.values[nextBase] - profile.values[base]) * blend,
    g:
      profile.values[base + 1] +
      (profile.values[nextBase + 1] - profile.values[base + 1]) * blend,
    b:
      profile.values[base + 2] +
      (profile.values[nextBase + 2] - profile.values[base + 2]) * blend,
  };
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
  profile: EnvironmentProfile,
  lutSize: number,
  thetaSamples: number,
  phiSamples: number,
) => {
  const lut = new Float32Array(lutSize * 3);
  const thetaStep = (Math.PI * 0.5) / thetaSamples;
  const phiStep = (Math.PI * 2) / phiSamples;

  for (let i = 0; i < lutSize; i++) {
    const normalUp = (i / (lutSize - 1)) * 2 - 1;
    const normalSide = Math.sqrt(Math.max(0, 1 - normalUp * normalUp));

    let irradianceR = 0;
    let irradianceG = 0;
    let irradianceB = 0;
    for (let thetaIndex = 0; thetaIndex < thetaSamples; thetaIndex++) {
      const theta = (thetaIndex + 0.5) * thetaStep;
      const sinTheta = Math.sin(theta);
      const cosTheta = Math.cos(theta);
      const upBias = normalUp * cosTheta;
      const upScale = normalSide * sinTheta;
      const sampleWeight = cosTheta * sinTheta * thetaStep * phiStep * INV_PI;

      for (let phiIndex = 0; phiIndex < phiSamples; phiIndex++) {
        const phi = (phiIndex + 0.5) * phiStep;
        const sampleUp = upBias + upScale * Math.cos(phi);
        const sample = sampleProfile(profile, sampleUp);
        irradianceR += sample.r * sampleWeight;
        irradianceG += sample.g * sampleWeight;
        irradianceB += sample.b * sampleWeight;
      }
    }

    const base = i * 3;
    lut[base] = irradianceR;
    lut[base + 1] = irradianceG;
    lut[base + 2] = irradianceB;
  }

  return lut;
};

const buildSpecularPrefilterLut = (
  profile: EnvironmentProfile,
  upLutSize: number,
  roughnessLutSize: number,
  sampleCount: number,
) => {
  const lut = new Float32Array(upLutSize * roughnessLutSize * 3);

  for (
    let roughnessIndex = 0;
    roughnessIndex < roughnessLutSize;
    roughnessIndex++
  ) {
    const roughness = Math.max(0.045, roughnessIndex / (roughnessLutSize - 1));
    const alpha = roughness * roughness;
    const alphaSq = alpha * alpha;

    for (let upIndex = 0; upIndex < upLutSize; upIndex++) {
      const reflectionUp = (upIndex / (upLutSize - 1)) * 2 - 1;
      const reflectionSide = Math.sqrt(
        Math.max(0, 1 - reflectionUp * reflectionUp),
      );
      const rx = reflectionSide;
      const ry = 0;
      const rz = reflectionUp;

      let tx = 0;
      let ty = 1;
      let tz = 0;
      if (Math.abs(rz) < 0.999) {
        const tangentScale = 1 / Math.sqrt(rx * rx + ry * ry);
        tx = -ry * tangentScale;
        ty = rx * tangentScale;
      }

      const bx = ry * tz - rz * ty;
      const by = rz * tx - rx * tz;
      const bz = rx * ty - ry * tx;

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
        const hx = tx * hLocalX + bx * hLocalY + rx * cosTheta;
        const hy = ty * hLocalX + by * hLocalY + ry * cosTheta;
        const hz = tz * hLocalX + bz * hLocalY + rz * cosTheta;
        const vDotH = Math.max(rx * hx + ry * hy + rz * hz, 0);
        const lx = 2 * vDotH * hx - rx;
        const ly = 2 * vDotH * hy - ry;
        const lz = 2 * vDotH * hz - rz;
        const nDotL = Math.max(rx * lx + ry * ly + rz * lz, 0);
        if (nDotL <= 0) {
          continue;
        }

        const sample = sampleProfile(profile, lz);
        prefilteredR += sample.r * nDotL;
        prefilteredG += sample.g * nDotL;
        prefilteredB += sample.b * nDotL;
        totalWeight += nDotL;
      }

      const base = (roughnessIndex * upLutSize + upIndex) * 3;
      const weightScale = totalWeight > 0 ? 1 / totalWeight : 0;
      lut[base] = prefilteredR * weightScale;
      lut[base + 1] = prefilteredG * weightScale;
      lut[base + 2] = prefilteredB * weightScale;
    }
  }

  return lut;
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
  const profile = buildEnvironmentProfile(environmentTexture);

  return {
    diffuseIrradianceLut: buildDiffuseIrradianceLut(
      profile,
      diffuseIrradianceLutSize,
      diffuseIrradianceThetaSamples,
      diffuseIrradiancePhiSamples,
    ),
    specularPrefilterLut: buildSpecularPrefilterLut(
      profile,
      specularPrefilterUpLutSize,
      specularPrefilterRoughnessLutSize,
      specularPrefilterSampleCount,
    ),
    specularBrdfLut: buildSpecularBrdfLut(
      specularBrdfLutSize,
      specularBrdfSampleCount,
    ),
    diffuseIrradianceLutSize,
    specularPrefilterUpLutSize,
    specularPrefilterRoughnessLutSize,
    specularBrdfLutSize,
  };
};
