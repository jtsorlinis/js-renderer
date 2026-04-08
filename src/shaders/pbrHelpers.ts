import { Vector3 } from "../maths";

export const EPSILON = 0.00001;
export const DIELECTRIC_F0 = new Vector3(0.04, 0.04, 0.04);
export const INV_PI = 1 / Math.PI;
export const INV_21 = 1 / 21;

export const saturate = (value: number) => {
  return Math.max(0, Math.min(1, value));
};

export const mixVec3 = (a: Vector3, b: Vector3, t: number) => {
  const invT = 1 - t;
  return new Vector3(
    a.x * invT + b.x * t,
    a.y * invT + b.y * t,
    a.z * invT + b.z * t,
  );
};

export const toneMapLinear = (colour: Vector3, exposure: number) => {
  return new Vector3(
    colour.x * exposure,
    colour.y * exposure,
    colour.z * exposure,
  );
};

export const fresnelSchlick = (cosTheta: number, f0: Vector3) => {
  const factor = Math.pow(1 - saturate(cosTheta), 5);
  return new Vector3(
    f0.x + (1 - f0.x) * factor,
    f0.y + (1 - f0.y) * factor,
    f0.z + (1 - f0.z) * factor,
  );
};

export const fresnelSchlickRoughness = (
  cosTheta: number,
  f0: Vector3,
  roughness: number,
) => {
  const factor = Math.pow(1 - saturate(cosTheta), 5);
  const f90x = Math.max(1 - roughness, f0.x);
  const f90y = Math.max(1 - roughness, f0.y);
  const f90z = Math.max(1 - roughness, f0.z);
  return new Vector3(
    f0.x + (f90x - f0.x) * factor,
    f0.y + (f90y - f0.y) * factor,
    f0.z + (f90z - f0.z) * factor,
  );
};

export const distributionGGX = (nDotH: number, roughness: number) => {
  const alpha = roughness * roughness;
  const alphaSq = alpha * alpha;
  const denom = nDotH * nDotH * (alphaSq - 1) + 1;
  return alphaSq / Math.max(Math.PI * denom * denom, EPSILON);
};

const geometrySchlickGGX = (nDotX: number, roughness: number) => {
  const r = roughness + 1;
  const k = (r * r) / 8;
  return nDotX / Math.max(nDotX * (1 - k) + k, EPSILON);
};

export const geometrySmith = (
  nDotV: number,
  nDotL: number,
  roughness: number,
) => {
  return (
    geometrySchlickGGX(nDotV, roughness) * geometrySchlickGGX(nDotL, roughness)
  );
};
