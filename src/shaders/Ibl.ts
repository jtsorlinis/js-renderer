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
import { buildProceduralIbl } from "./IblHelpers";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  lightCol: Vector3;
  mLightDir: Vector3;
  mWorldUp: Vector3;
  mCamPos: Vector3;
  texture: Texture;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

const shadowBias = 0.01;
const lightIntensity = 3.14;
const exposure = 1;

const sky = new Vector3(0.46, 0.42, 0.39);
const horizon = new Vector3(0.72, 0.63, 0.54);
const ground = new Vector3(0.07, 0.055, 0.045);
const blend = 0.18;
const {
  diffuseIrradianceLut,
  diffuseIrradianceLutSize,
  specularPrefilterLut,
  specularPrefilterUpLutSize,
  specularPrefilterRoughnessLutSize,
  specularBrdfLut,
  specularBrdfLutSize,
} = buildProceduralIbl({ sky, horizon, ground, blend });

// This shader keeps a few math-heavy sections expanded inline on purpose for
// performance in the software renderer hot path.
export class IblShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector3>();
  vLightDirTangent = this.varying<Vector3>();
  vViewDirTangent = this.varying<Vector3>();
  vWorldUpTangent = this.varying<Vector3>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];

    // Inlined equivalent to normalize(cross(N, T)) * tangent.w.
    const bitangentX = normal.y * tangent.z - normal.z * tangent.y;
    const bitangentY = normal.z * tangent.x - normal.x * tangent.z;
    const bitangentZ = normal.x * tangent.y - normal.y * tangent.x;
    const bitangentLengthSq =
      bitangentX * bitangentX +
      bitangentY * bitangentY +
      bitangentZ * bitangentZ;
    const bitangentScale =
      bitangentLengthSq > 0.00000001
        ? tangent.w / Math.sqrt(bitangentLengthSq)
        : 0;
    const bitangent = new Vector3(
      bitangentX * bitangentScale,
      bitangentY * bitangentScale,
      bitangentZ * bitangentScale,
    );

    const modelPos = model.vertices[i];
    const lightDirTangent = new Vector3(
      tangent.dot3(this.uniforms.mLightDir),
      bitangent.dot(this.uniforms.mLightDir),
      normal.dot(this.uniforms.mLightDir),
    );

    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const viewDirTangent = new Vector3(
      tangent.dot3(viewDir),
      bitangent.dot(viewDir),
      normal.dot(viewDir),
    );
    const worldUpTangent = new Vector3(
      tangent.dot3(this.uniforms.mWorldUp),
      bitangent.dot(this.uniforms.mWorldUp),
      normal.dot(this.uniforms.mWorldUp),
    );

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);
    this.v2f(this.vWorldUpTangent, worldUpTangent);

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
    const lightDirTangent = this.interpolateVec3(
      this.vLightDirTangent,
    ).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();
    const worldUp = this.interpolateVec3(this.vWorldUpTangent);
    if (worldUp.lengthSq() > EPSILON) {
      worldUp.normalize();
    } else {
      worldUp.x = 0;
      worldUp.y = 1;
      worldUp.z = 0;
    }

    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    const normal = this.sample(this.uniforms.normalTexture, uv);
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

    const lightDir = lightDirTangent.scaleInPlace(-1);
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

    // Ambient uses a diffuse irradiance integral plus split-sum style specular
    // from the same procedural environment.
    const ambientFresnelFactor = Math.pow(1 - saturate(nDotV), 5);
    const f90x = Math.max(1 - roughness, f0x);
    const f90y = Math.max(1 - roughness, f0y);
    const f90z = Math.max(1 - roughness, f0z);
    const ksAmbientX = f0x + (f90x - f0x) * ambientFresnelFactor;
    const ksAmbientY = f0y + (f90y - f0y) * ambientFresnelFactor;
    const ksAmbientZ = f0z + (f90z - f0z) * ambientFresnelFactor;
    const ambientDiffuseFactor = 1 - metallic;
    const normalUp = normal.dot(worldUp);
    const diffuseLutCoord =
      saturate(normalUp * 0.5 + 0.5) * (diffuseIrradianceLutSize - 1);
    const diffuseLutIndex = Math.floor(diffuseLutCoord);
    const diffuseLutNext = Math.min(
      diffuseLutIndex + 1,
      diffuseIrradianceLutSize - 1,
    );
    const diffuseLutBlend = diffuseLutCoord - diffuseLutIndex;
    const diffuseLutBase = diffuseLutIndex * 3;
    const diffuseLutBaseNext = diffuseLutNext * 3;
    const diffuseEnvR =
      diffuseIrradianceLut[diffuseLutBase] +
      (diffuseIrradianceLut[diffuseLutBaseNext] -
        diffuseIrradianceLut[diffuseLutBase]) *
        diffuseLutBlend;
    const diffuseEnvG =
      diffuseIrradianceLut[diffuseLutBase + 1] +
      (diffuseIrradianceLut[diffuseLutBaseNext + 1] -
        diffuseIrradianceLut[diffuseLutBase + 1]) *
        diffuseLutBlend;
    const diffuseEnvB =
      diffuseIrradianceLut[diffuseLutBase + 2] +
      (diffuseIrradianceLut[diffuseLutBaseNext + 2] -
        diffuseIrradianceLut[diffuseLutBase + 2]) *
        diffuseLutBlend;

    const reflectionScale = 2 * nDotV;
    const reflectionX = normal.x * reflectionScale - viewDir.x;
    const reflectionY = normal.y * reflectionScale - viewDir.y;
    const reflectionZ = normal.z * reflectionScale - viewDir.z;
    const reflectionUp =
      reflectionX * worldUp.x +
      reflectionY * worldUp.y +
      reflectionZ * worldUp.z;
    const specularUpCoord =
      saturate(reflectionUp * 0.5 + 0.5) * (specularPrefilterUpLutSize - 1);
    const specularUpIndex = Math.floor(specularUpCoord);
    const specularUpNext = Math.min(
      specularUpIndex + 1,
      specularPrefilterUpLutSize - 1,
    );
    const specularUpBlend = specularUpCoord - specularUpIndex;
    const specularRoughnessCoord =
      roughness * (specularPrefilterRoughnessLutSize - 1);
    const specularRoughnessIndex = Math.floor(specularRoughnessCoord);
    const specularRoughnessNext = Math.min(
      specularRoughnessIndex + 1,
      specularPrefilterRoughnessLutSize - 1,
    );
    const specularRoughnessBlend =
      specularRoughnessCoord - specularRoughnessIndex;
    const specularBase00 =
      (specularRoughnessIndex * specularPrefilterUpLutSize + specularUpIndex) *
      3;
    const specularBase10 =
      (specularRoughnessIndex * specularPrefilterUpLutSize + specularUpNext) *
      3;
    const specularBase01 =
      (specularRoughnessNext * specularPrefilterUpLutSize + specularUpIndex) *
      3;
    const specularBase11 =
      (specularRoughnessNext * specularPrefilterUpLutSize + specularUpNext) * 3;
    const specularEnvR0 =
      specularPrefilterLut[specularBase00] +
      (specularPrefilterLut[specularBase10] -
        specularPrefilterLut[specularBase00]) *
        specularUpBlend;
    const specularEnvR1 =
      specularPrefilterLut[specularBase01] +
      (specularPrefilterLut[specularBase11] -
        specularPrefilterLut[specularBase01]) *
        specularUpBlend;
    const specularEnvG0 =
      specularPrefilterLut[specularBase00 + 1] +
      (specularPrefilterLut[specularBase10 + 1] -
        specularPrefilterLut[specularBase00 + 1]) *
        specularUpBlend;
    const specularEnvG1 =
      specularPrefilterLut[specularBase01 + 1] +
      (specularPrefilterLut[specularBase11 + 1] -
        specularPrefilterLut[specularBase01 + 1]) *
        specularUpBlend;
    const specularEnvB0 =
      specularPrefilterLut[specularBase00 + 2] +
      (specularPrefilterLut[specularBase10 + 2] -
        specularPrefilterLut[specularBase00 + 2]) *
        specularUpBlend;
    const specularEnvB1 =
      specularPrefilterLut[specularBase01 + 2] +
      (specularPrefilterLut[specularBase11 + 2] -
        specularPrefilterLut[specularBase01 + 2]) *
        specularUpBlend;
    const specularEnvR =
      specularEnvR0 + (specularEnvR1 - specularEnvR0) * specularRoughnessBlend;
    const specularEnvG =
      specularEnvG0 + (specularEnvG1 - specularEnvG0) * specularRoughnessBlend;
    const specularEnvB =
      specularEnvB0 + (specularEnvB1 - specularEnvB0) * specularRoughnessBlend;

    const brdfViewCoord = nDotV * (specularBrdfLutSize - 1);
    const brdfViewIndex = Math.floor(brdfViewCoord);
    const brdfViewNext = Math.min(brdfViewIndex + 1, specularBrdfLutSize - 1);
    const brdfViewBlend = brdfViewCoord - brdfViewIndex;
    const brdfRoughnessCoord = roughness * (specularBrdfLutSize - 1);
    const brdfRoughnessIndex = Math.floor(brdfRoughnessCoord);
    const brdfRoughnessNext = Math.min(
      brdfRoughnessIndex + 1,
      specularBrdfLutSize - 1,
    );
    const brdfRoughnessBlend = brdfRoughnessCoord - brdfRoughnessIndex;
    const brdfBase00 =
      (brdfRoughnessIndex * specularBrdfLutSize + brdfViewIndex) * 2;
    const brdfBase10 =
      (brdfRoughnessIndex * specularBrdfLutSize + brdfViewNext) * 2;
    const brdfBase01 =
      (brdfRoughnessNext * specularBrdfLutSize + brdfViewIndex) * 2;
    const brdfBase11 =
      (brdfRoughnessNext * specularBrdfLutSize + brdfViewNext) * 2;
    const brdfA0 =
      specularBrdfLut[brdfBase00] +
      (specularBrdfLut[brdfBase10] - specularBrdfLut[brdfBase00]) *
        brdfViewBlend;
    const brdfA1 =
      specularBrdfLut[brdfBase01] +
      (specularBrdfLut[brdfBase11] - specularBrdfLut[brdfBase01]) *
        brdfViewBlend;
    const brdfB0 =
      specularBrdfLut[brdfBase00 + 1] +
      (specularBrdfLut[brdfBase10 + 1] - specularBrdfLut[brdfBase00 + 1]) *
        brdfViewBlend;
    const brdfB1 =
      specularBrdfLut[brdfBase01 + 1] +
      (specularBrdfLut[brdfBase11 + 1] - specularBrdfLut[brdfBase01 + 1]) *
        brdfViewBlend;
    const envBrdfA = brdfA0 + (brdfA1 - brdfA0) * brdfRoughnessBlend;
    const envBrdfB = brdfB0 + (brdfB1 - brdfB0) * brdfRoughnessBlend;

    const ambientR =
      (1 - ksAmbientX) * baseColor.x * diffuseEnvR * ambientDiffuseFactor +
      (f0x * envBrdfA + envBrdfB) * specularEnvR;
    const ambientG =
      (1 - ksAmbientY) * baseColor.y * diffuseEnvG * ambientDiffuseFactor +
      (f0y * envBrdfA + envBrdfB) * specularEnvG;
    const ambientB =
      (1 - ksAmbientZ) * baseColor.z * diffuseEnvB * ambientDiffuseFactor +
      (f0z * envBrdfA + envBrdfB) * specularEnvB;

    return new Vector3(
      (ambientR + directR) * exposure,
      (ambientG + directG) * exposure,
      (ambientB + directB) * exposure,
    );
  };
}
