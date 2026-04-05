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

const ambientIntensity = 0.25;

// This shader keeps a few math-heavy sections expanded inline on purpose for
// performance in the software renderer hot path.
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
    // Inlined equivalent to the usual vec3 F0/Fresnel lighting path to reduce
    // fragment allocations in this hot shader.
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

      // Inlined equivalent to the usual vec3 BRDF combine.
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

    // Inlined constant-white IBL approximation without an environment texture
    // or BRDF LUT. The diffuse term is exact for a constant environment and
    // the specular term uses a compact EnvBRDF fit.
    const ambientFresnelFactor = Math.pow(1 - saturate(nDotV), 5);
    const f90x = Math.max(1 - roughness, f0x);
    const f90y = Math.max(1 - roughness, f0y);
    const f90z = Math.max(1 - roughness, f0z);
    const ksAmbientX = f0x + (f90x - f0x) * ambientFresnelFactor;
    const ksAmbientY = f0y + (f90y - f0y) * ambientFresnelFactor;
    const ksAmbientZ = f0z + (f90z - f0z) * ambientFresnelFactor;
    const ambientDiffuseFactor = (1 - metallic) * ambientIntensity;
    const rx = 1 - roughness;
    const a004 =
      Math.min(rx * rx, Math.pow(2, -9.28 * nDotV)) * rx +
      (0.0425 - 0.0275 * roughness);
    const envBrdfA = -1.04 * a004 + (1.04 - 0.572 * roughness);
    const envBrdfB = 1.04 * a004 + (-0.04 + 0.022 * roughness);
    const ambientR =
      (1 - ksAmbientX) * baseColor.x * ambientDiffuseFactor +
      (ksAmbientX * envBrdfA + envBrdfB) * ambientIntensity;
    const ambientG =
      (1 - ksAmbientY) * baseColor.y * ambientDiffuseFactor +
      (ksAmbientY * envBrdfA + envBrdfB) * ambientIntensity;
    const ambientB =
      (1 - ksAmbientZ) * baseColor.z * ambientDiffuseFactor +
      (ksAmbientZ * envBrdfA + envBrdfB) * ambientIntensity;

    return new Vector3(
      (ambientR + directR) * exposure,
      (ambientG + directG) * exposure,
      (ambientB + directB) * exposure,
    );
  };
}
