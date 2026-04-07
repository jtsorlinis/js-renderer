import { Vector3 } from "../maths";
import {
  EPSILON,
  INV_PI,
  distributionGGX,
  geometrySmith,
  saturate,
} from "../shaders/pbrHelpers";

const SUN_INTENSITY = 0;

export interface PathTraceLightingHit {
  baseColor: Vector3;
  f0: Vector3;
  metallic: number;
  roughness: number;
  shadingNormal: Vector3;
}

export const evaluateDirectSunLighting = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
  lightDir: Vector3,
  lightColor: Vector3,
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
  const lightScale = nDotL * SUN_INTENSITY;

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
  lightDirection: Vector3,
  radiance: Vector3,
  pdf: number,
) => {
  if (hit.metallic >= 1 || pdf <= 0) {
    return Vector3.Zero;
  }

  const nDotL = saturate(hit.shadingNormal.dot(lightDirection));
  if (nDotL <= 0) {
    return Vector3.Zero;
  }

  const diffuseScale = ((1 - hit.metallic) * INV_PI * nDotL) / pdf;
  return new Vector3(
    hit.baseColor.x * radiance.x * diffuseScale,
    hit.baseColor.y * radiance.y * diffuseScale,
    hit.baseColor.z * radiance.z * diffuseScale,
  );
};
