import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";
import { type PbrMaterial } from "../utils/modelLoader";
import {
  DIELECTRIC_F0,
  EPSILON,
  INV_21,
  INV_PI,
  distributionGGX,
  geometrySmith,
  saturate,
} from "./pbrHelpers";
import {
  sampleLatLongMapInto,
  type IblData,
  wrapUnit,
  INV_TAU,
} from "./IblHelpers";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  modelMat: Matrix4;
  normalMat: Matrix4;
  lightCol: Vector3;
  negLightDir: Vector3;
  envYawSin: number;
  envYawCos: number;
  camPos: Vector3;
  orthographic: boolean;
  viewDirWorld: Vector3;
  texture: Texture;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
  iblData: IblData;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

const shadowBias = 0.01;
// We lower the intensity of the direct light to keep the IBL mode consistent
// with the other modes, since the environment now also contributes to lighting.
const lightIntensity = 1.88;
const environmentIntensity = 0.6;

// This shader keeps a few math-heavy sections expanded inline on purpose for
// performance in the software renderer hot path.
export class IblShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vViewDirWorld = this.varying<Vector3>();
  vWorldNormal = this.varying<Vector3>();
  vWorldTangent = this.varying<Vector4>();
  vLightSpacePos = this.varying<Vector3>();

  private diffuseEnv = new Vector3();
  private specularEnv = new Vector3();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];
    const modelPos = model.vertices[i];
    const worldPos = this.uniforms.modelMat.transformPoint(modelPos);
    const worldNormal = this.uniforms.normalMat
      .transformDirection(normal)
      .normalize();
    const worldTangent = this.uniforms.modelMat
      .transformDirection4(tangent)
      .normalize3();
    const viewDirWorld = this.uniforms.orthographic
      ? this.uniforms.viewDirWorld
      : this.uniforms.camPos.subtract(worldPos).normalize();

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vViewDirWorld, viewDirWorld);
    this.v2f(this.vWorldNormal, worldNormal);
    this.v2f(this.vWorldTangent, worldTangent);
    this.v2f(this.vLightSpacePos, lightSpacePos);

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const ibl = this.uniforms.iblData;
    const uv = this.interpolateVec2(this.vUV);
    const viewDir = this.interpolateVec3(this.vViewDirWorld).normalize();
    const tangent = this.interpolateVec4(this.vWorldTangent);
    const handedness = tangent.w < 0 ? -1 : 1;
    const surfaceNormal = this.interpolateVec3(this.vWorldNormal).normalize();

    const tangentProjection =
      surfaceNormal.x * tangent.x +
      surfaceNormal.y * tangent.y +
      surfaceNormal.z * tangent.z;
    let tangentOrthoX = tangent.x - surfaceNormal.x * tangentProjection;
    let tangentOrthoY = tangent.y - surfaceNormal.y * tangentProjection;
    let tangentOrthoZ = tangent.z - surfaceNormal.z * tangentProjection;
    const tangentOrthoLengthSq =
      tangentOrthoX * tangentOrthoX +
      tangentOrthoY * tangentOrthoY +
      tangentOrthoZ * tangentOrthoZ;
    const tangentOrthoScale =
      tangentOrthoLengthSq > EPSILON ? 1 / Math.sqrt(tangentOrthoLengthSq) : 0;
    tangentOrthoX *= tangentOrthoScale;
    tangentOrthoY *= tangentOrthoScale;
    tangentOrthoZ *= tangentOrthoScale;
    const bitangentX =
      (surfaceNormal.y * tangentOrthoZ - surfaceNormal.z * tangentOrthoY) *
      handedness;
    const bitangentY =
      (surfaceNormal.z * tangentOrthoX - surfaceNormal.x * tangentOrthoZ) *
      handedness;
    const bitangentZ =
      (surfaceNormal.x * tangentOrthoY - surfaceNormal.y * tangentOrthoX) *
      handedness;
    const normalTexel = this.sample(this.uniforms.normalTexture, uv);
    let normalX =
      tangentOrthoX * normalTexel.x +
      bitangentX * normalTexel.y +
      surfaceNormal.x * normalTexel.z;
    let normalY =
      tangentOrthoY * normalTexel.x +
      bitangentY * normalTexel.y +
      surfaceNormal.y * normalTexel.z;
    let normalZ =
      tangentOrthoZ * normalTexel.x +
      bitangentZ * normalTexel.y +
      surfaceNormal.z * normalTexel.z;
    const normalLengthSq =
      normalX * normalX + normalY * normalY + normalZ * normalZ;
    const normalScale =
      normalLengthSq > EPSILON ? 1 / Math.sqrt(normalLengthSq) : 0;
    normalX *= normalScale;
    normalY *= normalScale;
    normalZ *= normalScale;
    const baseColor = this.sample(this.uniforms.texture, uv).multiplyInPlace(
      this.uniforms.pbrMaterial.baseColorFactor,
    );
    const metallicRoughness = this.sample(
      this.uniforms.pbrMaterial.metallicRoughnessTexture,
      uv,
    );
    const roughness = Math.max(
      0.045,
      saturate(metallicRoughness.y * this.uniforms.pbrMaterial.roughnessFactor),
    );
    const metallic = saturate(
      metallicRoughness.z * this.uniforms.pbrMaterial.metallicFactor,
    );
    const f0x = DIELECTRIC_F0.x + (baseColor.x - DIELECTRIC_F0.x) * metallic;
    const f0y = DIELECTRIC_F0.y + (baseColor.y - DIELECTRIC_F0.y) * metallic;
    const f0z = DIELECTRIC_F0.z + (baseColor.z - DIELECTRIC_F0.z) * metallic;

    const lightDir = this.uniforms.negLightDir;
    const nDotL = saturate(
      normalX * lightDir.x + normalY * lightDir.y + normalZ * lightDir.z,
    );
    const rawNDotV =
      normalX * viewDir.x + normalY * viewDir.y + normalZ * viewDir.z;
    const nDotV = saturate(rawNDotV);
    const halfDir = lightDir.add(viewDir);

    let directR = 0;
    let directG = 0;
    let directB = 0;
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
      const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
      const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;
      halfDir.normalize();
      const nDotH = saturate(
        normalX * halfDir.x + normalY * halfDir.y + normalZ * halfDir.z,
      );
      const vDotH = saturate(viewDir.dot(halfDir));
      const fresnelBase = 1 - vDotH;
      const fresnelBaseSq = fresnelBase * fresnelBase;
      const fresnelFactor = fresnelBaseSq * fresnelBaseSq * fresnelBase;
      const fresnelX = f0x + (1 - f0x) * fresnelFactor;
      const fresnelY = f0y + (1 - f0y) * fresnelFactor;
      const fresnelZ = f0z + (1 - f0z) * fresnelFactor;
      const distribution = distributionGGX(nDotH, roughness);
      const geometry = geometrySmith(nDotV, nDotL, roughness);
      const specularFactor =
        (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
      const diffuseFactor = (1 - metallic) * INV_PI;
      const lightScale = nDotL * shadow * lightIntensity;

      directR =
        ((1 - fresnelX) * diffuseFactor * baseColor.x +
          fresnelX * specularFactor) *
        this.uniforms.lightCol.x *
        lightScale;
      directG =
        ((1 - fresnelY) * diffuseFactor * baseColor.y +
          fresnelY * specularFactor) *
        this.uniforms.lightCol.y *
        lightScale;
      directB =
        ((1 - fresnelZ) * diffuseFactor * baseColor.z +
          fresnelZ * specularFactor) *
        this.uniforms.lightCol.z *
        lightScale;
    }

    // Ambient uses directional irradiance plus split-sum style specular from
    // the precomputed environment maps.
    const ambientDiffuseFactor = 1 - metallic;
    const diffuseDirX =
      normalX * this.uniforms.envYawCos - normalZ * this.uniforms.envYawSin;
    const diffuseDirZ =
      normalX * this.uniforms.envYawSin + normalZ * this.uniforms.envYawCos;
    const diffuseU = wrapUnit(
      Math.atan2(diffuseDirX, diffuseDirZ) * INV_TAU + 0.5,
    );
    const diffuseV = Math.acos(Math.max(-1, Math.min(1, normalY))) * INV_PI;
    sampleLatLongMapInto(
      ibl.diffuseIrradianceMap,
      ibl.diffuseIrradianceMapWidth,
      ibl.diffuseIrradianceMapHeight,
      diffuseU,
      diffuseV,
      this.diffuseEnv,
    );

    const reflectionScale = 2 * rawNDotV;
    const reflectionX = normalX * reflectionScale - viewDir.x;
    const reflectionY = normalY * reflectionScale - viewDir.y;
    const reflectionZ = normalZ * reflectionScale - viewDir.z;
    const rotatedReflectionX =
      reflectionX * this.uniforms.envYawCos -
      reflectionZ * this.uniforms.envYawSin;
    const rotatedReflectionZ =
      reflectionX * this.uniforms.envYawSin +
      reflectionZ * this.uniforms.envYawCos;
    const reflectionU = wrapUnit(
      Math.atan2(rotatedReflectionX, rotatedReflectionZ) * INV_TAU + 0.5,
    );
    const reflectionV =
      Math.acos(Math.max(-1, Math.min(1, reflectionY))) * INV_PI;
    const specularRoughnessIndex = Math.min(
      ibl.specularPrefilterRoughnessMaxIndex,
      Math.round(roughness * ibl.specularPrefilterRoughnessMaxIndex),
    );
    sampleLatLongMapInto(
      ibl.specularPrefilterMap,
      ibl.specularPrefilterMapWidth,
      ibl.specularPrefilterMapHeight,
      reflectionU,
      reflectionV,
      this.specularEnv,
      specularRoughnessIndex,
      ibl.specularPrefilterLayerStride,
    );

    const brdfViewCoord = nDotV * ibl.specularBrdfLutMaxIndex;
    const brdfViewIndex = Math.floor(brdfViewCoord);
    const brdfViewNext = Math.min(
      brdfViewIndex + 1,
      ibl.specularBrdfLutMaxIndex,
    );
    const brdfViewBlend = brdfViewCoord - brdfViewIndex;
    const brdfRoughnessCoord = roughness * ibl.specularBrdfLutMaxIndex;
    const brdfRoughnessIndex = Math.floor(brdfRoughnessCoord);
    const brdfRoughnessNext = Math.min(
      brdfRoughnessIndex + 1,
      ibl.specularBrdfLutMaxIndex,
    );
    const brdfRoughnessBlend = brdfRoughnessCoord - brdfRoughnessIndex;
    const brdfBase00 =
      (brdfRoughnessIndex * ibl.specularBrdfLutSize + brdfViewIndex) * 2;
    const brdfBase10 =
      (brdfRoughnessIndex * ibl.specularBrdfLutSize + brdfViewNext) * 2;
    const brdfBase01 =
      (brdfRoughnessNext * ibl.specularBrdfLutSize + brdfViewIndex) * 2;
    const brdfBase11 =
      (brdfRoughnessNext * ibl.specularBrdfLutSize + brdfViewNext) * 2;
    const brdfA0 =
      ibl.specularBrdfLut[brdfBase00] +
      (ibl.specularBrdfLut[brdfBase10] - ibl.specularBrdfLut[brdfBase00]) *
        brdfViewBlend;
    const brdfA1 =
      ibl.specularBrdfLut[brdfBase01] +
      (ibl.specularBrdfLut[brdfBase11] - ibl.specularBrdfLut[brdfBase01]) *
        brdfViewBlend;
    const brdfB0 =
      ibl.specularBrdfLut[brdfBase00 + 1] +
      (ibl.specularBrdfLut[brdfBase10 + 1] -
        ibl.specularBrdfLut[brdfBase00 + 1]) *
        brdfViewBlend;
    const brdfB1 =
      ibl.specularBrdfLut[brdfBase01 + 1] +
      (ibl.specularBrdfLut[brdfBase11 + 1] -
        ibl.specularBrdfLut[brdfBase01 + 1]) *
        brdfViewBlend;
    const envBrdfA = brdfA0 + (brdfA1 - brdfA0) * brdfRoughnessBlend;
    const envBrdfB = brdfB0 + (brdfB1 - brdfB0) * brdfRoughnessBlend;

    const ambientFresnelBase = 1 - nDotV;
    const ambientFresnelBaseSq = ambientFresnelBase * ambientFresnelBase;
    const ambientFresnelFactor =
      ambientFresnelBaseSq * ambientFresnelBaseSq * ambientFresnelBase;
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
    const fmsEmsX =
      ((fssEssX * favgX) / Math.max(1 - ems * favgX, EPSILON)) * ems;
    const fmsEmsY =
      ((fssEssY * favgY) / Math.max(1 - ems * favgY, EPSILON)) * ems;
    const fmsEmsZ =
      ((fssEssZ * favgZ) / Math.max(1 - ems * favgZ, EPSILON)) * ems;
    const specularWeightX = fssEssX + fmsEmsX;
    const specularWeightY = fssEssY + fmsEmsY;
    const specularWeightZ = fssEssZ + fmsEmsZ;
    const diffuseWeightX = Math.max(0, 1 - specularWeightX);
    const diffuseWeightY = Math.max(0, 1 - specularWeightY);
    const diffuseWeightZ = Math.max(0, 1 - specularWeightZ);

    const ambientR =
      (diffuseWeightX * baseColor.x * this.diffuseEnv.x * ambientDiffuseFactor +
        specularWeightX * this.specularEnv.x) *
      environmentIntensity;
    const ambientG =
      (diffuseWeightY * baseColor.y * this.diffuseEnv.y * ambientDiffuseFactor +
        specularWeightY * this.specularEnv.y) *
      environmentIntensity;
    const ambientB =
      (diffuseWeightZ * baseColor.z * this.diffuseEnv.z * ambientDiffuseFactor +
        specularWeightZ * this.specularEnv.z) *
      environmentIntensity;

    return new Vector3(
      ambientR + directR,
      ambientG + directG,
      ambientB + directB,
    );
  };
}
