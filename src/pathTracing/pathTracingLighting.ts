import { Vector3 } from "../maths";
import {
  EPSILON,
  INV_PI,
  distributionGGX,
  fresnelSchlick,
  geometrySmith,
  saturate,
} from "../shaders/pbrHelpers";

export interface PathTraceLightingHit {
  baseColor: Vector3;
  f0: Vector3;
  metallic: number;
  roughness: number;
  shadingNormal: Vector3;
}

export interface PathTraceBsdfEvaluation {
  nDotL: number;
  pdf: number;
  value: Vector3;
}

export const getSpecularSamplingProbability = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
) => {
  const cosTheta = saturate(hit.shadingNormal.dot(viewDir));
  const fresnel = fresnelSchlick(cosTheta, hit.f0);
  const fresnelAverage = (fresnel.x + fresnel.y + fresnel.z) / 3;
  return Math.max(
    0.05,
    Math.min(0.95, fresnelAverage + hit.metallic * (1 - fresnelAverage)),
  );
};

export const evaluateBsdf = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
  lightDir: Vector3,
  specularProbability: number,
): PathTraceBsdfEvaluation => {
  const nDotL = saturate(hit.shadingNormal.dot(lightDir));
  const nDotV = saturate(hit.shadingNormal.dot(viewDir));
  if (nDotL <= 0 || nDotV <= 0) {
    return {
      nDotL: 0,
      pdf: 0,
      value: Vector3.Zero,
    };
  }

  const halfDir = lightDir.add(viewDir);
  if (halfDir.lengthSq() <= EPSILON) {
    return {
      nDotL: 0,
      pdf: 0,
      value: Vector3.Zero,
    };
  }

  halfDir.normalize();
  const nDotH = saturate(hit.shadingNormal.dot(halfDir));
  const vDotH = saturate(viewDir.dot(halfDir));
  if (nDotH <= 0 || vDotH <= 0) {
    return {
      nDotL: 0,
      pdf: 0,
      value: Vector3.Zero,
    };
  }

  const fresnel = fresnelSchlick(vDotH, hit.f0);
  const distribution = distributionGGX(nDotH, hit.roughness);
  const geometry = geometrySmith(nDotV, nDotL, hit.roughness);
  const specularFactor =
    (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
  const diffuseFactor = (1 - hit.metallic) * INV_PI;
  const diffusePdf = nDotL * INV_PI;
  const specularPdf = (distribution * nDotH) / Math.max(4 * vDotH, EPSILON);

  return {
    nDotL,
    pdf:
      (1 - specularProbability) * diffusePdf +
      specularProbability * specularPdf,
    value: new Vector3(
      hit.baseColor.x * diffuseFactor + fresnel.x * specularFactor,
      hit.baseColor.y * diffuseFactor + fresnel.y * specularFactor,
      hit.baseColor.z * diffuseFactor + fresnel.z * specularFactor,
    ),
  };
};

const powerHeuristic = (a: number, b: number) => {
  const a2 = a * a;
  const b2 = b * b;
  return a2 / Math.max(a2 + b2, EPSILON);
};

export const evaluateDirectSunLighting = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
  lightDir: Vector3,
  lightColor: Vector3,
  lightIntensity: number,
) => {
  const nDotL = saturate(hit.shadingNormal.dot(lightDir));
  const nDotV = saturate(hit.shadingNormal.dot(viewDir));
  if (nDotL <= 0 || nDotV <= 0) {
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
  const lightScale = nDotL * lightIntensity;

  return new Vector3(
    ((1 - fresnelX) * diffuseFactor * hit.baseColor.x +
      fresnelX * specularFactor) *
      lightColor.x *
      lightScale,
    ((1 - fresnelY) * diffuseFactor * hit.baseColor.y +
      fresnelY * specularFactor) *
      lightColor.y *
      lightScale,
    ((1 - fresnelZ) * diffuseFactor * hit.baseColor.z +
      fresnelZ * specularFactor) *
      lightColor.z *
      lightScale,
  );
};

export const evaluateDirectEnvironmentLighting = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
  lightDirection: Vector3,
  radiance: Vector3,
  lightPdf: number,
  environmentIntensity: number,
  specularProbability: number,
) => {
  if (lightPdf <= 0) {
    return Vector3.Zero;
  }

  const bsdf = evaluateBsdf(hit, viewDir, lightDirection, specularProbability);
  if (bsdf.nDotL <= 0 || bsdf.pdf <= 0) {
    return Vector3.Zero;
  }

  const scale =
    (bsdf.nDotL * environmentIntensity * powerHeuristic(lightPdf, bsdf.pdf)) /
    lightPdf;
  return new Vector3(
    bsdf.value.x * radiance.x * scale,
    bsdf.value.y * radiance.y * scale,
    bsdf.value.z * radiance.z * scale,
  );
};
