import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";
import { type PbrMaterial } from "../utils/modelLoader";
import {
  EPSILON,
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
  vLightSpacePos = this.varying<Vector4>();
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
      tangent.dot(this.uniforms.mLightDir),
      bitangent.dot(this.uniforms.mLightDir),
      normal.dot(this.uniforms.mLightDir),
    );

    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const viewDirTangent = new Vector3(
      tangent.dot(viewDir),
      bitangent.dot(viewDir),
      normal.dot(viewDir),
    );

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint4(modelPos);

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec4(
      this.vLightSpacePos,
    ).perspectiveDivide();
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
    const lightDirTangent = this.interpolateVec3(
      this.vLightDirTangent,
    ).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();

    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    const normal = this.sample(this.uniforms.normalTexture, uv);
    const baseColor = this.sample(this.uniforms.texture, uv).multiply(
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
    const f0 = mixVec3(new Vector3(0.04, 0.04, 0.04), baseColor, metallic);

    const lightDir = lightDirTangent.scale(-1).normalize();
    const halfDir = viewDir.add(lightDir);
    const nDotL = saturate(normal.dot(lightDir));
    const nDotV = saturate(normal.dot(viewDir));

    let directLighting = Vector3.Zero;
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      halfDir.normalize();
      const nDotH = saturate(normal.dot(halfDir));
      const vDotH = saturate(viewDir.dot(halfDir));
      const fresnel = fresnelSchlick(vDotH, f0);
      const distribution = distributionGGX(nDotH, roughness);
      const geometry = geometrySmith(nDotV, nDotL, roughness);
      const specular = fresnel.scale(
        (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON),
      );
      const diffuse = Vector3.One.subtract(fresnel)
        .scale(1 - metallic)
        .multiply(baseColor)
        .scale(1 / Math.PI);

      directLighting = diffuse
        .add(specular)
        .multiply(this.uniforms.lightCol)
        .scale(nDotL * shadow * lightIntensity);
    }

    // Direct-light-only PBR still needs a small environment stand-in until IBL exists.
    const ksAmbient = fresnelSchlickRoughness(nDotV, f0, roughness);
    const kdAmbient = Vector3.One.subtract(ksAmbient).scale(1 - metallic);
    const ambientDiffuse = kdAmbient
      .multiply(baseColor)
      .scale(ambientIntensity);
    const ambientSpecular = ksAmbient.scale(
      ambientIntensity * (1 - roughness * 0.5),
    );
    const ambient = ambientDiffuse.add(ambientSpecular);

    return toneMapLinear(ambient.add(directLighting), exposure);
  };
}
