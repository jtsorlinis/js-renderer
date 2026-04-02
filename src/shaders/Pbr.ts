import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";
import { type PbrMaterial } from "../utils/modelLoader";

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

const EPSILON = 0.00001;
const SHADOW_BIAS = 0.01;
const DIRECT_LIGHT_INTENSITY = 2.5;
const AMBIENT_INTENSITY = 0.025;
const DISPLAY_EXPOSURE = 1.5;

const saturate = (value: number) => {
  return Math.max(0, Math.min(1, value));
};

const mixVec3 = (a: Vector3, b: Vector3, t: number) => {
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

const srgbToLinear = (colour: Vector3) => {
  return new Vector3(
    srgbToLinearChannel(colour.x),
    srgbToLinearChannel(colour.y),
    srgbToLinearChannel(colour.z),
  );
};

const linearToSrgb = (colour: Vector3) => {
  return new Vector3(
    linearToSrgbChannel(saturate(colour.x)),
    linearToSrgbChannel(saturate(colour.y)),
    linearToSrgbChannel(saturate(colour.z)),
  );
};

const toneMap = (colour: Vector3) => {
  const exposed = colour.scale(DISPLAY_EXPOSURE);
  return new Vector3(
    exposed.x / (1 + exposed.x),
    exposed.y / (1 + exposed.y),
    exposed.z / (1 + exposed.z),
  );
};

const fresnelSchlick = (cosTheta: number, f0: Vector3) => {
  const factor = Math.pow(1 - saturate(cosTheta), 5);
  return f0.add(Vector3.One.subtract(f0).scale(factor));
};

const distributionGGX = (nDotH: number, roughness: number) => {
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

const geometrySmith = (nDotV: number, nDotL: number, roughness: number) => {
  return (
    geometrySchlickGGX(nDotV, roughness) * geometrySchlickGGX(nDotL, roughness)
  );
};

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

    const lightSpacePos = this.uniforms.lightSpaceMat.projectPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);

    return this.uniforms.mvp.projectPoint(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec4(this.vLightSpacePos);
    const lightDirTangent = this.interpolateVec3(
      this.vLightDirTangent,
    ).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();

    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - SHADOW_BIAS > depth ? 0 : 1;

    const normal = this.sample(this.uniforms.normalTexture, uv);
    const baseColor = srgbToLinear(
      this.sample(this.uniforms.texture, uv),
    ).multiply(this.uniforms.pbrMaterial.baseColorFactor);
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

    const lightDir = lightDirTangent.scale(-1).normalize();
    const halfDir = viewDir.add(lightDir);
    const nDotL = saturate(normal.dot(lightDir));
    const nDotV = saturate(normal.dot(viewDir));

    let directLighting = Vector3.Zero;
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      halfDir.normalize();
      const nDotH = saturate(normal.dot(halfDir));
      const vDotH = saturate(viewDir.dot(halfDir));
      const f0 = mixVec3(new Vector3(0.04, 0.04, 0.04), baseColor, metallic);
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
        .scale(nDotL * shadow * DIRECT_LIGHT_INTENSITY);
    }

    // Direct-light-only PBR still needs a small environment stand-in until IBL exists.
    const f0 = mixVec3(new Vector3(0.04, 0.04, 0.04), baseColor, metallic);
    const ambient = baseColor
      .scale(1 - metallic)
      .scale(AMBIENT_INTENSITY)
      .add(f0.scale(AMBIENT_INTENSITY * 0.5));

    return linearToSrgb(toneMap(ambient.add(directLighting)));
  };
}
