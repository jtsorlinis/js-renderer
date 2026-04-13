import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture } from "../drawing";
import { type Material } from "../materials/Material";
import {
  DIELECTRIC_F0,
  EPSILON,
  INV_21,
  INV_PI,
  distributionGGX,
  geometrySmith,
  saturate,
} from "./pbrHelpers";
import { type IblData, wrapUnit, INV_TAU, sampleLatLongMap } from "./iblHelpers";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  modelMat: Matrix4;
  normalMat: Matrix4;
  lightCol: Vector3;
  worldLightDir: Vector3;
  envYaw: { sin: number; cos: number };
  worldCamPos: Vector3;
  orthographic: boolean;
  worldViewDir: Vector3;
  material: Material;
  iblData: IblData;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
  receiveShadows: boolean;
}

const minBias = 0.001;
const maxBias = 0.005;
// We lower the intensity of the direct light to keep the IBL mode consistent
// with the other modes, since the environment now also contributes to lighting.
const lightIntensity = 1.88;
const environmentIntensity = 0.6;

// This shader keeps a few math-heavy sections expanded inline on purpose for
// performance in the software renderer hot path.
export class IblShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vWorldPos = this.varying<Vector3>();
  vWorldNormal = this.varying<Vector3>();
  vWorldTangent = this.varying<Vector4>();
  vLightSpacePos = this.varying<Vector3>();

  vertex = () => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const modelPos = model.vertices[i];
    const worldPos = this.uniforms.modelMat.transformPoint(modelPos);
    const worldNormal = this.uniforms.normalMat.transformDirection(model.normals[i]).normalize();
    const worldTangent = this.uniforms.modelMat.transformDirection4(model.tangents[i]).normalize3();

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vWorldPos, worldPos);
    this.v2f(this.vWorldNormal, worldNormal);
    this.v2f(this.vWorldTangent, worldTangent);

    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
      lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
      lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
      this.v2f(this.vLightSpacePos, lightSpacePos);
    }

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const material = this.uniforms.material;
    const ibl = this.uniforms.iblData;
    const uv = this.interpolateVec2(this.vUV);
    const worldPos = this.interpolateVec3(this.vWorldPos);
    const worldViewDir = this.uniforms.orthographic
      ? this.uniforms.worldViewDir
      : this.uniforms.worldCamPos.subtract(worldPos).normalize();
    const worldNormal = this.interpolateVec3(this.vWorldNormal).normalize();
    const worldTangent = this.interpolateVec4(this.vWorldTangent);
    const handedness = worldTangent.w < 0 ? -1 : 1;

    const tDotN = worldTangent.dot3(worldNormal);
    const Tx = worldTangent.x - worldNormal.x * tDotN;
    const Ty = worldTangent.y - worldNormal.y * tDotN;
    const Tz = worldTangent.z - worldNormal.z * tDotN;
    const TLengthSq = Tx * Tx + Ty * Ty + Tz * Tz;
    const TScale = 1 / Math.sqrt(TLengthSq);
    const T = new Vector3(Tx * TScale, Ty * TScale, Tz * TScale);

    const Bx = (worldNormal.y * T.z - worldNormal.z * T.y) * handedness;
    const By = (worldNormal.z * T.x - worldNormal.x * T.z) * handedness;
    const Bz = (worldNormal.x * T.y - worldNormal.y * T.x) * handedness;

    const normalTexel = this.sample(material.normalTexture, uv);
    const Nx = T.x * normalTexel.x + Bx * normalTexel.y + worldNormal.x * normalTexel.z;
    const Ny = T.y * normalTexel.x + By * normalTexel.y + worldNormal.y * normalTexel.z;
    const Nz = T.z * normalTexel.x + Bz * normalTexel.y + worldNormal.z * normalTexel.z;
    const NLengthSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = 1 / Math.sqrt(NLengthSq);
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

    const baseColor = this.sample(material.colorTexture, uv).multiplyInPlace(material.colorFactor);
    const metallicRoughness = this.sample(material.metallicRoughnessTexture, uv);
    const roughness = Math.max(0.045, saturate(metallicRoughness.y * material.roughnessFactor));
    const metallic = saturate(metallicRoughness.z * material.metallicFactor);
    const f0x = DIELECTRIC_F0.x + (baseColor.x - DIELECTRIC_F0.x) * metallic;
    const f0y = DIELECTRIC_F0.y + (baseColor.y - DIELECTRIC_F0.y) * metallic;
    const f0z = DIELECTRIC_F0.z + (baseColor.z - DIELECTRIC_F0.z) * metallic;

    const worldLightDir = this.uniforms.worldLightDir;
    const nDotL = saturate(
      -(normal.x * worldLightDir.x + normal.y * worldLightDir.y + normal.z * worldLightDir.z),
    );
    const rawNDotV =
      normal.x * worldViewDir.x + normal.y * worldViewDir.y + normal.z * worldViewDir.z;
    const nDotV = saturate(rawNDotV);

    let directR = 0;
    let directG = 0;
    let directB = 0;
    if (nDotL > 0 && nDotV > 0) {
      let shadow = 1;
      if (this.uniforms.receiveShadows) {
        const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
        const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
        const faceNDotL = saturate(-worldNormal.dot(this.uniforms.worldLightDir));
        const bias = minBias + (maxBias - minBias) * (1 - faceNDotL);
        shadow = lightSpacePos.z - bias > depth ? 0 : 1;
      }

      if (shadow > 0) {
        const halfDir = worldViewDir.subtract(worldLightDir).normalize();
        const nDotH = saturate(normal.x * halfDir.x + normal.y * halfDir.y + normal.z * halfDir.z);
        const vDotH = saturate(worldViewDir.dot(halfDir));
        const fresnelBase = 1 - vDotH;
        const fresnelBaseSq = fresnelBase * fresnelBase;
        const fresnelFactor = fresnelBaseSq * fresnelBaseSq * fresnelBase;
        const fresnelX = f0x + (1 - f0x) * fresnelFactor;
        const fresnelY = f0y + (1 - f0y) * fresnelFactor;
        const fresnelZ = f0z + (1 - f0z) * fresnelFactor;
        const distribution = distributionGGX(nDotH, roughness);
        const geometry = geometrySmith(nDotV, nDotL, roughness);
        const specularFactor = (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
        const diffuseFactor = (1 - metallic) * INV_PI;
        const lightScale = nDotL * lightIntensity;

        directR =
          ((1 - fresnelX) * diffuseFactor * baseColor.x + fresnelX * specularFactor) *
          this.uniforms.lightCol.x *
          lightScale;
        directG =
          ((1 - fresnelY) * diffuseFactor * baseColor.y + fresnelY * specularFactor) *
          this.uniforms.lightCol.y *
          lightScale;
        directB =
          ((1 - fresnelZ) * diffuseFactor * baseColor.z + fresnelZ * specularFactor) *
          this.uniforms.lightCol.z *
          lightScale;
      }
    }

    // Ambient uses directional irradiance plus split-sum style specular from
    // the precomputed environment maps.
    const envYaw = this.uniforms.envYaw;
    const ambientDiffuseFactor = 1 - metallic;
    const diffuseDirX = normal.x * envYaw.cos - normal.z * envYaw.sin;
    const diffuseDirZ = normal.x * envYaw.sin + normal.z * envYaw.cos;
    const diffuseU = wrapUnit(Math.atan2(diffuseDirX, diffuseDirZ) * INV_TAU + 0.5);
    const diffuseV = Math.acos(Math.max(-1, Math.min(1, normal.y))) * INV_PI;
    const diffuseEnv = sampleLatLongMap(
      ibl.diffuseIrradianceMap,
      ibl.diffuseIrradianceMapWidth,
      ibl.diffuseIrradianceMapHeight,
      diffuseU,
      diffuseV,
    );

    const reflectionScale = 2 * rawNDotV;
    const reflectionX = normal.x * reflectionScale - worldViewDir.x;
    const reflectionY = normal.y * reflectionScale - worldViewDir.y;
    const reflectionZ = normal.z * reflectionScale - worldViewDir.z;
    const rotatedReflectionX = reflectionX * envYaw.cos - reflectionZ * envYaw.sin;
    const rotatedReflectionZ = reflectionX * envYaw.sin + reflectionZ * envYaw.cos;
    const reflectionU = wrapUnit(
      Math.atan2(rotatedReflectionX, rotatedReflectionZ) * INV_TAU + 0.5,
    );
    const reflectionV = Math.acos(Math.max(-1, Math.min(1, reflectionY))) * INV_PI;
    const specularRoughnessIndex = Math.min(
      ibl.specularPrefilterRoughnessMaxIndex,
      Math.round(roughness * ibl.specularPrefilterRoughnessMaxIndex),
    );
    const specularEnv = sampleLatLongMap(
      ibl.specularPrefilterMap,
      ibl.specularPrefilterMapWidth,
      ibl.specularPrefilterMapHeight,
      reflectionU,
      reflectionV,
      specularRoughnessIndex,
      ibl.specularPrefilterLayerStride,
    );

    const brdfViewCoord = nDotV * ibl.specularBrdfLutMaxIndex;
    const brdfViewIndex = Math.floor(brdfViewCoord);
    const brdfViewNext = Math.min(brdfViewIndex + 1, ibl.specularBrdfLutMaxIndex);
    const brdfViewBlend = brdfViewCoord - brdfViewIndex;
    const brdfRoughnessCoord = roughness * ibl.specularBrdfLutMaxIndex;
    const brdfRoughnessIndex = Math.floor(brdfRoughnessCoord);
    const brdfRoughnessNext = Math.min(brdfRoughnessIndex + 1, ibl.specularBrdfLutMaxIndex);
    const brdfRoughnessBlend = brdfRoughnessCoord - brdfRoughnessIndex;
    const brdfBase00 = (brdfRoughnessIndex * ibl.specularBrdfLutSize + brdfViewIndex) * 2;
    const brdfBase10 = (brdfRoughnessIndex * ibl.specularBrdfLutSize + brdfViewNext) * 2;
    const brdfBase01 = (brdfRoughnessNext * ibl.specularBrdfLutSize + brdfViewIndex) * 2;
    const brdfBase11 = (brdfRoughnessNext * ibl.specularBrdfLutSize + brdfViewNext) * 2;
    const brdfA0 =
      ibl.specularBrdfLut[brdfBase00] +
      (ibl.specularBrdfLut[brdfBase10] - ibl.specularBrdfLut[brdfBase00]) * brdfViewBlend;
    const brdfA1 =
      ibl.specularBrdfLut[brdfBase01] +
      (ibl.specularBrdfLut[brdfBase11] - ibl.specularBrdfLut[brdfBase01]) * brdfViewBlend;
    const brdfB0 =
      ibl.specularBrdfLut[brdfBase00 + 1] +
      (ibl.specularBrdfLut[brdfBase10 + 1] - ibl.specularBrdfLut[brdfBase00 + 1]) * brdfViewBlend;
    const brdfB1 =
      ibl.specularBrdfLut[brdfBase01 + 1] +
      (ibl.specularBrdfLut[brdfBase11 + 1] - ibl.specularBrdfLut[brdfBase01 + 1]) * brdfViewBlend;
    const envBrdfA = brdfA0 + (brdfA1 - brdfA0) * brdfRoughnessBlend;
    const envBrdfB = brdfB0 + (brdfB1 - brdfB0) * brdfRoughnessBlend;

    const ambientFresnelBase = 1 - nDotV;
    const ambientFresnelBaseSq = ambientFresnelBase * ambientFresnelBase;
    const ambientFresnelFactor = ambientFresnelBaseSq * ambientFresnelBaseSq * ambientFresnelBase;
    const frX = Math.max(1 - roughness, f0x) - f0x;
    const frY = Math.max(1 - roughness, f0y) - f0y;
    const frZ = Math.max(1 - roughness, f0z) - f0z;
    const ksX = f0x + frX * ambientFresnelFactor;
    const ksY = f0y + frY * ambientFresnelFactor;
    const ksZ = f0z + frZ * ambientFresnelFactor;
    const fssEssX = ksX * envBrdfA + envBrdfB;
    const fssEssY = ksY * envBrdfA + envBrdfB;
    const fssEssZ = ksZ * envBrdfA + envBrdfB;
    const ems = Math.max(0, 1 - (envBrdfA + envBrdfB));
    const favgX = f0x + (1 - f0x) * INV_21;
    const favgY = f0y + (1 - f0y) * INV_21;
    const favgZ = f0z + (1 - f0z) * INV_21;
    const fmsEmsX = ((fssEssX * favgX) / Math.max(1 - ems * favgX, EPSILON)) * ems;
    const fmsEmsY = ((fssEssY * favgY) / Math.max(1 - ems * favgY, EPSILON)) * ems;
    const fmsEmsZ = ((fssEssZ * favgZ) / Math.max(1 - ems * favgZ, EPSILON)) * ems;
    const specularWeightX = fssEssX + fmsEmsX;
    const specularWeightY = fssEssY + fmsEmsY;
    const specularWeightZ = fssEssZ + fmsEmsZ;
    const diffuseWeightX = Math.max(0, 1 - specularWeightX);
    const diffuseWeightY = Math.max(0, 1 - specularWeightY);
    const diffuseWeightZ = Math.max(0, 1 - specularWeightZ);

    const ambientR =
      (diffuseWeightX * baseColor.x * diffuseEnv.x * ambientDiffuseFactor +
        specularWeightX * specularEnv.x) *
      environmentIntensity;
    const ambientG =
      (diffuseWeightY * baseColor.y * diffuseEnv.y * ambientDiffuseFactor +
        specularWeightY * specularEnv.y) *
      environmentIntensity;
    const ambientB =
      (diffuseWeightZ * baseColor.z * diffuseEnv.z * ambientDiffuseFactor +
        specularWeightZ * specularEnv.z) *
      environmentIntensity;

    return new Vector3(ambientR + directR, ambientG + directG, ambientB + directB);
  };
}
