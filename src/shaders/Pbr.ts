import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";
import { type PbrMaterial } from "../utils/modelLoader";
import {
  DIELECTRIC_F0,
  EPSILON,
  INV_PI,
  distributionGGX,
  fresnelSchlick,
  fresnelSchlickRoughness,
  geometrySmith,
  mixVec3,
  saturate,
  toneMapLinear,
} from "./pbrHelpers";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  lightCol: Vector3;
  mLightDir: Vector3;
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

const ambientIntensity = 0.05;

export class PbrShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector3>();
  vLightDirTangent = this.varying<Vector3>();
  vViewDirTangent = this.varying<Vector3>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];
    const bitangent = model.bitangents[i];

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

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
    const lightDirTangent = this.interpolateVec3(
      this.vLightDirTangent,
    ).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();

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
    const f0 = mixVec3(DIELECTRIC_F0, baseColor, metallic);

    const lightDir = lightDirTangent.scaleInPlace(-1);
    const nDotL = saturate(normal.dot(lightDir));
    const nDotV = saturate(normal.dot(viewDir));
    const halfDir = lightDir.addInPlace(viewDir);

    let directLighting = new Vector3();
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      halfDir.normalize();
      const nDotH = saturate(normal.dot(halfDir));
      const vDotH = saturate(viewDir.dot(halfDir));
      const fresnel = fresnelSchlick(vDotH, f0);
      const distribution = distributionGGX(nDotH, roughness);
      const geometry = geometrySmith(nDotV, nDotL, roughness);
      const specularFactor =
        (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
      const diffuseFactor = (1 - metallic) * INV_PI;
      const lightScale = nDotL * shadow * lightIntensity;

      // Keep the BRDF combine readable while avoiding vector churn in the fragment hot path.
      const directR =
        ((1 - fresnel.x) * diffuseFactor * baseColor.x +
          fresnel.x * specularFactor) *
        this.uniforms.lightCol.x *
        lightScale;
      const directG =
        ((1 - fresnel.y) * diffuseFactor * baseColor.y +
          fresnel.y * specularFactor) *
        this.uniforms.lightCol.y *
        lightScale;
      const directB =
        ((1 - fresnel.z) * diffuseFactor * baseColor.z +
          fresnel.z * specularFactor) *
        this.uniforms.lightCol.z *
        lightScale;

      directLighting = new Vector3(directR, directG, directB);
    }

    // Direct-light-only PBR still needs a small environment stand-in without IBL
    const ksAmbient = fresnelSchlickRoughness(nDotV, f0, roughness);
    const ambientDiffuseFactor = (1 - metallic) * ambientIntensity;
    const ambientSpecularFactor = ambientIntensity * (1 - roughness * 0.5);
    const ambient = new Vector3(
      (1 - ksAmbient.x) * baseColor.x * ambientDiffuseFactor +
        ksAmbient.x * ambientSpecularFactor,
      (1 - ksAmbient.y) * baseColor.y * ambientDiffuseFactor +
        ksAmbient.y * ambientSpecularFactor,
      (1 - ksAmbient.z) * baseColor.z * ambientDiffuseFactor +
        ksAmbient.z * ambientSpecularFactor,
    );

    return toneMapLinear(ambient.addInPlace(directLighting), exposure);
  };
}
