import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";
import { type PbrMaterial } from "../utils/modelLoader";
import {
  DIELECTRIC_F0,
  EPSILON,
  INV_PI,
  distributionGGX,
  geometrySmith,
  saturate,
} from "./pbrHelpers";
import { type IblData } from "./IblHelpers";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  modelMat: Matrix4;
  normalMat: Matrix4;
  lightCol: Vector3;
  lightDir: Vector3;
  camPos: Vector3;
  texture: Texture;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
  iblData: IblData;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

const shadowBias = 0.01;
const lightIntensity = 3.14;
const exposure = 1;
const TAU = Math.PI * 2;
const INV_TAU = 1 / TAU;

// This shader keeps a few math-heavy sections expanded inline on purpose for
// performance in the software renderer hot path.
export class IblShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vWorldPos = this.varying<Vector3>();
  vWorldNormal = this.varying<Vector3>();
  vWorldTangent = this.varying<Vector4>();
  vLightSpacePos = this.varying<Vector3>();

  private diffuseEnv = new Vector3();
  private specularEnv0 = new Vector3();
  private specularEnv1 = new Vector3();

  private wrapUnit = (value: number) => {
    return value - Math.floor(value);
  };

  private sampleLatLongMap = (
    data: Float32Array,
    width: number,
    height: number,
    u: number,
    v: number,
    out: Vector3,
    layerIndex = 0,
  ) => {
    const xIndex = Math.max(
      0,
      Math.min(width - 1, Math.round(this.wrapUnit(u) * (width - 1))),
    );
    const yIndex = Math.max(
      0,
      Math.min(height - 1, Math.round(v * (height - 1))),
    );
    const layerOffset = layerIndex * width * height * 3;
    const base = layerOffset + (yIndex * width + xIndex) * 3;
    out.x = data[base];
    out.y = data[base + 1];
    out.z = data[base + 2];
    return out;
  };

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
      .transformDirection(tangent.xyz)
      .normalize();

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vWorldPos, worldPos);
    this.v2f(this.vWorldNormal, worldNormal);
    this.v2f(
      this.vWorldTangent,
      new Vector4(worldTangent.x, worldTangent.y, worldTangent.z, tangent.w),
    );
    this.v2f(this.vLightSpacePos, lightSpacePos);

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const ibl = this.uniforms.iblData;
    const uv = this.interpolateVec2(this.vUV);
    const worldPos = this.interpolateVec3(this.vWorldPos);
    const tangent4 = this.interpolateVec4(this.vWorldTangent);
    const tangent = tangent4.xyz;
    const handedness = tangent4.w < 0 ? -1 : 1;
    const surfaceNormal = this.interpolateVec3(this.vWorldNormal).normalize();
    const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);

    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    const tangentOrtho = tangent
      .subtractInPlace(surfaceNormal.scale(surfaceNormal.dot(tangent)))
      .normalize();
    const bitangent = surfaceNormal
      .cross(tangentOrtho)
      .scaleInPlace(handedness);
    const normalTexel = this.sample(this.uniforms.normalTexture, uv);
    const normal = tangentOrtho
      .scaleInPlace(normalTexel.x)
      .addInPlace(bitangent.scaleInPlace(normalTexel.y))
      .addInPlace(surfaceNormal.scaleInPlace(normalTexel.z))
      .normalize();
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

    const lightDir = new Vector3(
      -this.uniforms.lightDir.x,
      -this.uniforms.lightDir.y,
      -this.uniforms.lightDir.z,
    );
    const viewDir = this.uniforms.camPos.subtract(worldPos).normalize();
    const nDotL = saturate(normal.dot(lightDir));
    const nDotV = saturate(normal.dot(viewDir));
    const halfDir = lightDir.addInPlace(viewDir);

    let directR = 0;
    let directG = 0;
    let directB = 0;
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      halfDir.normalize();
      const nDotH = saturate(normal.dot(halfDir));
      const vDotH = saturate(viewDir.dot(halfDir));
      const fresnelFactor = Math.pow(1 - saturate(vDotH), 5);
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
    const ambientFresnelFactor = Math.pow(1 - saturate(nDotV), 5);
    const f90x = Math.max(1 - roughness, f0x);
    const f90y = Math.max(1 - roughness, f0y);
    const f90z = Math.max(1 - roughness, f0z);
    const ksAmbientX = f0x + (f90x - f0x) * ambientFresnelFactor;
    const ksAmbientY = f0y + (f90y - f0y) * ambientFresnelFactor;
    const ksAmbientZ = f0z + (f90z - f0z) * ambientFresnelFactor;
    const ambientDiffuseFactor = 1 - metallic;
    const diffuseU = this.wrapUnit(
      Math.atan2(normal.x, normal.z) * INV_TAU + 0.5,
    );
    const diffuseV = Math.acos(Math.max(-1, Math.min(1, normal.y))) * INV_PI;
    this.sampleLatLongMap(
      ibl.diffuseIrradianceMap,
      ibl.diffuseIrradianceMapWidth,
      ibl.diffuseIrradianceMapHeight,
      diffuseU,
      diffuseV,
      this.diffuseEnv,
    );

    const reflectionScale = 2 * nDotV;
    const reflectionX = normal.x * reflectionScale - viewDir.x;
    const reflectionY = normal.y * reflectionScale - viewDir.y;
    const reflectionZ = normal.z * reflectionScale - viewDir.z;
    const reflectionU = this.wrapUnit(
      Math.atan2(reflectionX, reflectionZ) * INV_TAU + 0.5,
    );
    const reflectionV =
      Math.acos(Math.max(-1, Math.min(1, reflectionY))) * INV_PI;
    const specularRoughnessCoord =
      roughness * (ibl.specularPrefilterRoughnessLutSize - 1);
    const specularRoughnessIndex = Math.floor(specularRoughnessCoord);
    const specularRoughnessNext = Math.min(
      specularRoughnessIndex + 1,
      ibl.specularPrefilterRoughnessLutSize - 1,
    );
    const specularRoughnessBlend =
      specularRoughnessCoord - specularRoughnessIndex;
    this.sampleLatLongMap(
      ibl.specularPrefilterMap,
      ibl.specularPrefilterMapWidth,
      ibl.specularPrefilterMapHeight,
      reflectionU,
      reflectionV,
      this.specularEnv0,
      specularRoughnessIndex,
    );
    this.sampleLatLongMap(
      ibl.specularPrefilterMap,
      ibl.specularPrefilterMapWidth,
      ibl.specularPrefilterMapHeight,
      reflectionU,
      reflectionV,
      this.specularEnv1,
      specularRoughnessNext,
    );
    const specularEnvR =
      this.specularEnv0.x +
      (this.specularEnv1.x - this.specularEnv0.x) * specularRoughnessBlend;
    const specularEnvG =
      this.specularEnv0.y +
      (this.specularEnv1.y - this.specularEnv0.y) * specularRoughnessBlend;
    const specularEnvB =
      this.specularEnv0.z +
      (this.specularEnv1.z - this.specularEnv0.z) * specularRoughnessBlend;

    const brdfViewCoord = nDotV * (ibl.specularBrdfLutSize - 1);
    const brdfViewIndex = Math.floor(brdfViewCoord);
    const brdfViewNext = Math.min(
      brdfViewIndex + 1,
      ibl.specularBrdfLutSize - 1,
    );
    const brdfViewBlend = brdfViewCoord - brdfViewIndex;
    const brdfRoughnessCoord = roughness * (ibl.specularBrdfLutSize - 1);
    const brdfRoughnessIndex = Math.floor(brdfRoughnessCoord);
    const brdfRoughnessNext = Math.min(
      brdfRoughnessIndex + 1,
      ibl.specularBrdfLutSize - 1,
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

    const ambientR =
      (1 - ksAmbientX) *
        baseColor.x *
        this.diffuseEnv.x *
        ambientDiffuseFactor +
      (f0x * envBrdfA + envBrdfB) * specularEnvR;
    const ambientG =
      (1 - ksAmbientY) *
        baseColor.y *
        this.diffuseEnv.y *
        ambientDiffuseFactor +
      (f0y * envBrdfA + envBrdfB) * specularEnvG;
    const ambientB =
      (1 - ksAmbientZ) *
        baseColor.z *
        this.diffuseEnv.z *
        ambientDiffuseFactor +
      (f0z * envBrdfA + envBrdfB) * specularEnvB;

    return new Vector3(
      (ambientR + directR) * exposure,
      (ambientG + directG) * exposure,
      (ambientB + directB) * exposure,
    );
  };
}
