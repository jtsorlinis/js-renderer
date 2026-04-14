import { saturate, Vector3 } from "../maths";
import { type IblData } from "../shaders/iblHelpers";
import { EPSILON, INV_21, INV_PI, distributionGGX, fresnelSchlick } from "../shaders/pbrHelpers";

export interface PathTraceLightingHit {
  baseColor: Vector3;
  f0: Vector3;
  geometricNormal: Vector3;
  metallic: number;
  roughness: number;
  shadingNormal: Vector3;
}

export interface PathTraceBsdfEvaluation {
  nDotL: number;
  pdf: number;
  value: Vector3;
}

interface PathTraceBrdfEvaluation {
  diffusePdf: number;
  nDotL: number;
  specularPdf: number;
  value: Vector3;
}

const geometrySmithExact = (nDotV: number, nDotL: number, roughness: number) => {
  const alpha = roughness * roughness;
  const alphaSq = alpha * alpha;
  const g1 = (nDotX: number) => {
    return (
      (2 * nDotX) / Math.max(nDotX + Math.sqrt(alphaSq + (1 - alphaSq) * nDotX * nDotX), EPSILON)
    );
  };

  return g1(nDotV) * g1(nDotL);
};

const sampleSpecularBrdfLut = (iblData: IblData, nDotV: number, roughness: number) => {
  const viewCoord = saturate(nDotV) * iblData.specularBrdfLutMaxIndex;
  const viewIndex = Math.floor(viewCoord);
  const viewNext = Math.min(viewIndex + 1, iblData.specularBrdfLutMaxIndex);
  const viewBlend = viewCoord - viewIndex;
  const roughnessCoord = saturate(roughness) * iblData.specularBrdfLutMaxIndex;
  const roughnessIndex = Math.floor(roughnessCoord);
  const roughnessNext = Math.min(roughnessIndex + 1, iblData.specularBrdfLutMaxIndex);
  const roughnessBlend = roughnessCoord - roughnessIndex;
  const base00 = (roughnessIndex * iblData.specularBrdfLutSize + viewIndex) * 2;
  const base10 = (roughnessIndex * iblData.specularBrdfLutSize + viewNext) * 2;
  const base01 = (roughnessNext * iblData.specularBrdfLutSize + viewIndex) * 2;
  const base11 = (roughnessNext * iblData.specularBrdfLutSize + viewNext) * 2;
  const a0 =
    iblData.specularBrdfLut[base00] +
    (iblData.specularBrdfLut[base10] - iblData.specularBrdfLut[base00]) * viewBlend;
  const a1 =
    iblData.specularBrdfLut[base01] +
    (iblData.specularBrdfLut[base11] - iblData.specularBrdfLut[base01]) * viewBlend;
  const b0 =
    iblData.specularBrdfLut[base00 + 1] +
    (iblData.specularBrdfLut[base10 + 1] - iblData.specularBrdfLut[base00 + 1]) * viewBlend;
  const b1 =
    iblData.specularBrdfLut[base01 + 1] +
    (iblData.specularBrdfLut[base11 + 1] - iblData.specularBrdfLut[base01 + 1]) * viewBlend;
  return {
    a: a0 + (a1 - a0) * roughnessBlend,
    b: b0 + (b1 - b0) * roughnessBlend,
  };
};

const getMultiScatterCompensation = (
  hit: PathTraceLightingHit,
  nDotV: number,
  iblData: IblData,
) => {
  const { a, b } = sampleSpecularBrdfLut(iblData, nDotV, hit.roughness);
  const singleScatterEnergy = Math.max(a + b, EPSILON);
  const multiScatterLoss = 1 - singleScatterEnergy;
  const favgX = hit.f0.x + (1 - hit.f0.x) * INV_21;
  const favgY = hit.f0.y + (1 - hit.f0.y) * INV_21;
  const favgZ = hit.f0.z + (1 - hit.f0.z) * INV_21;

  return new Vector3(
    1 / Math.max(1 - multiScatterLoss * favgX, EPSILON),
    1 / Math.max(1 - multiScatterLoss * favgY, EPSILON),
    1 / Math.max(1 - multiScatterLoss * favgZ, EPSILON),
  );
};

export const getSpecularSamplingProbability = (hit: PathTraceLightingHit, viewDir: Vector3) => {
  const cosTheta = saturate(hit.shadingNormal.dot(viewDir));
  const fresnel = fresnelSchlick(cosTheta, hit.f0);
  const fresnelAverage = (fresnel.x + fresnel.y + fresnel.z) / 3;
  return Math.max(0.05, Math.min(0.95, fresnelAverage + hit.metallic * (1 - fresnelAverage)));
};

const evaluateBrdf = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
  lightDir: Vector3,
  iblData: IblData,
): PathTraceBrdfEvaluation | undefined => {
  // Use the geometric normal to decide whether this is a valid reflection
  // direction pair, but evaluate the BRDF itself with the shading normal to
  // avoid leaks and dark spots when the normals disagree.
  if (hit.geometricNormal.dot(lightDir) * hit.geometricNormal.dot(viewDir) <= 0) {
    return undefined;
  }

  const shadingNDotL = hit.shadingNormal.dot(lightDir);
  const shadingNDotV = hit.shadingNormal.dot(viewDir);
  const nDotL = Math.abs(shadingNDotL);
  const nDotV = Math.abs(shadingNDotV);
  if (nDotL <= EPSILON || nDotV <= EPSILON) {
    return undefined;
  }

  const halfDir = lightDir.add(viewDir);
  if (halfDir.lengthSq() <= EPSILON) {
    return undefined;
  }

  halfDir.normalize();
  const nDotH = Math.abs(hit.shadingNormal.dot(halfDir));
  const vDotH = Math.abs(viewDir.dot(halfDir));
  if (nDotH <= 0 || vDotH <= 0) {
    return undefined;
  }

  const fresnel = fresnelSchlick(vDotH, hit.f0);
  const distribution = distributionGGX(nDotH, hit.roughness);
  const geometry = geometrySmithExact(nDotV, nDotL, hit.roughness);
  const specularFactor = (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
  const multiScatterCompensation = getMultiScatterCompensation(hit, nDotV, iblData);
  const diffuseFactor = (1 - hit.metallic) * INV_PI;

  return {
    diffusePdf: Math.max(0, shadingNDotL) * INV_PI,
    nDotL,
    specularPdf: (distribution * nDotH) / Math.max(4 * vDotH, EPSILON),
    value: new Vector3(
      hit.baseColor.x * diffuseFactor * (1 - fresnel.x) +
        fresnel.x * specularFactor * multiScatterCompensation.x,
      hit.baseColor.y * diffuseFactor * (1 - fresnel.y) +
        fresnel.y * specularFactor * multiScatterCompensation.y,
      hit.baseColor.z * diffuseFactor * (1 - fresnel.z) +
        fresnel.z * specularFactor * multiScatterCompensation.z,
    ),
  };
};

export const evaluateBsdf = (
  hit: PathTraceLightingHit,
  viewDir: Vector3,
  lightDir: Vector3,
  specularProbability: number,
  iblData: IblData,
): PathTraceBsdfEvaluation => {
  const brdf = evaluateBrdf(hit, viewDir, lightDir, iblData);
  if (!brdf) {
    return {
      nDotL: 0,
      pdf: 0,
      value: Vector3.Zero,
    };
  }

  return {
    nDotL: brdf.nDotL,
    pdf: (1 - specularProbability) * brdf.diffusePdf + specularProbability * brdf.specularPdf,
    value: brdf.value,
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
  lightIntensity: number,
  iblData: IblData,
) => {
  const brdf = evaluateBrdf(hit, viewDir, lightDir, iblData);
  if (!brdf) {
    return Vector3.Zero;
  }
  const lightScale = brdf.nDotL * lightIntensity;

  return new Vector3(
    brdf.value.x * lightScale,
    brdf.value.y * lightScale,
    brdf.value.z * lightScale,
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
  iblData: IblData,
) => {
  if (lightPdf <= 0) {
    return Vector3.Zero;
  }

  const bsdf = evaluateBsdf(hit, viewDir, lightDirection, specularProbability, iblData);
  if (bsdf.nDotL <= 0 || bsdf.pdf <= 0) {
    return Vector3.Zero;
  }

  const scale = (bsdf.nDotL * environmentIntensity * powerHeuristic(lightPdf, bsdf.pdf)) / lightPdf;
  return new Vector3(
    bsdf.value.x * radiance.x * scale,
    bsdf.value.y * radiance.y * scale,
    bsdf.value.z * radiance.z * scale,
  );
};
