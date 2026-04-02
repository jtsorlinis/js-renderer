import { Vector3 } from "../maths";

export const EPSILON = 0.00001;

export const saturate = (value: number) => {
  return Math.max(0, Math.min(1, value));
};

export const mixVec3 = (a: Vector3, b: Vector3, t: number) => {
  return a.scale(1 - t).add(b.scale(t));
};

const srgbToLinearChannel = (value: number) => {
  if (value <= 0.04045) {
    return value / 12.92;
  }
  return Math.pow((value + 0.055) / 1.055, 2.4);
};

const linearToSrgbChannel = (value: number) => {
  if (value <= 0.0031308) {
    return value * 12.92;
  }
  return 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
};

export const srgbToLinear = (colour: Vector3) => {
  return new Vector3(
    srgbToLinearChannel(colour.x),
    srgbToLinearChannel(colour.y),
    srgbToLinearChannel(colour.z),
  );
};

export const linearToSrgb = (colour: Vector3) => {
  return new Vector3(
    linearToSrgbChannel(saturate(colour.x)),
    linearToSrgbChannel(saturate(colour.y)),
    linearToSrgbChannel(saturate(colour.z)),
  );
};

export const toneMapLinear = (colour: Vector3, exposure: number) => {
  return colour.scale(exposure);
};

export const toneMapReinhard = (colour: Vector3, exposure: number) => {
  const exposed = colour.scale(exposure);
  return new Vector3(
    exposed.x / (1 + exposed.x),
    exposed.y / (1 + exposed.y),
    exposed.z / (1 + exposed.z),
  );
};

export const toneMapKhronos = (colour: Vector3, exposure: number) => {
  const exposed = colour.scale(exposure);
  const x = Math.min(exposed.x, Math.min(exposed.y, exposed.z));
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  const shifted = exposed.subtract(new Vector3(offset, offset, offset));
  const peak = Math.max(shifted.x, Math.max(shifted.y, shifted.z));
  const startCompression = 0.76;

  if (peak < startCompression) {
    return shifted;
  }

  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const compressed = shifted.scale(newPeak / peak);
  const desaturation = 0.15;
  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);

  return mixVec3(compressed, new Vector3(newPeak, newPeak, newPeak), g);
};

export const fresnelSchlick = (cosTheta: number, f0: Vector3) => {
  const factor = Math.pow(1 - saturate(cosTheta), 5);
  return f0.add(Vector3.One.subtract(f0).scale(factor));
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
