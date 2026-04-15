import { Vector3, Matrix4, Vector4, Vector2, saturate } from "../maths";
import { DepthTexture } from "../drawing";
import { type Material } from "../materials/Material";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";
import { DIELECTRIC_F0, EPSILON, INV_PI, distributionGGX, geometrySmith } from "./pbrHelpers";

export interface Uniforms {
  model: Mesh;
  mvp: Matrix4;
  modelLightDir: Vector3;
  modelCamPos: Vector3;
  material: Material;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
  receiveShadows: boolean;
}

const minBias = 0.001;
const maxBias = 0.005;
const lightIntensity = 3.14;

const ambientIntensity = 0.1;

// Direct-light PBR stage shown before the renderer adds image-based lighting.
export class PbrShader extends BaseShader<Uniforms> {
  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector3>();
  vModelPos = this.varying<Vector3>();
  vModelNormal = this.varying<Vector3>();
  vModelTangent = this.varying<Vector4>();

  vertex = () => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const modelPos = model.vertices[i];

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vModelPos, modelPos);
    this.v2f(this.vModelNormal, model.normals[i]);
    this.v2f(this.vModelTangent, model.tangents[i]);

    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
      lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
      lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
      this.v2f(this.vLightSpacePos, lightSpacePos);
    }

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const material = this.uniforms.material;
    const modelPos = this.interpolateVec3(this.vModelPos);
    const modelNormal = this.interpolateVec3(this.vModelNormal).normalize();
    const modelTangent = this.interpolateVec4(this.vModelTangent);
    const handedness = modelTangent.w < 0 ? -1 : 1;

    const tDotN = modelTangent.dot3(modelNormal);
    const Tx = modelTangent.x - modelNormal.x * tDotN;
    const Ty = modelTangent.y - modelNormal.y * tDotN;
    const Tz = modelTangent.z - modelNormal.z * tDotN;
    const TLengthSq = Tx * Tx + Ty * Ty + Tz * Tz;
    const TScale = 1 / Math.sqrt(TLengthSq);
    const T = new Vector3(Tx * TScale, Ty * TScale, Tz * TScale);

    const Bx = (modelNormal.y * T.z - modelNormal.z * T.y) * handedness;
    const By = (modelNormal.z * T.x - modelNormal.x * T.z) * handedness;
    const Bz = (modelNormal.x * T.y - modelNormal.y * T.x) * handedness;

    const normalTexel = this.sample(material.normalTexture, uv);
    const Nx = T.x * normalTexel.x + Bx * normalTexel.y + modelNormal.x * normalTexel.z;
    const Ny = T.y * normalTexel.x + By * normalTexel.y + modelNormal.y * normalTexel.z;
    const Nz = T.z * normalTexel.x + Bz * normalTexel.y + modelNormal.z * normalTexel.z;
    const NLengthSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = 1 / Math.sqrt(NLengthSq);
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

    const baseColor = this.sample(material.colorTexture, uv).multiplyInPlace(material.colorFactor);
    const orm = this.sample(material.ormTexture, uv);
    const ambientOcclusion = 1 - material.occlusionStrength + material.occlusionStrength * orm.x;
    const roughness = Math.max(0.045, saturate(orm.y * material.roughnessFactor));
    const metallic = saturate(orm.z * material.metallicFactor);
    const f0x = DIELECTRIC_F0.x + (baseColor.x - DIELECTRIC_F0.x) * metallic;
    const f0y = DIELECTRIC_F0.y + (baseColor.y - DIELECTRIC_F0.y) * metallic;
    const f0z = DIELECTRIC_F0.z + (baseColor.z - DIELECTRIC_F0.z) * metallic;

    const modelLightDir = this.uniforms.modelLightDir;
    const modelViewDir = this.uniforms.modelCamPos.subtract(modelPos).normalize();
    const nDotL = saturate(
      normal.x * modelLightDir.x + normal.y * modelLightDir.y + normal.z * modelLightDir.z,
    );
    const nDotV = saturate(
      normal.x * modelViewDir.x + normal.y * modelViewDir.y + normal.z * modelViewDir.z,
    );

    let directR = 0;
    let directG = 0;
    let directB = 0;
    if (nDotL > 0 && nDotV > 0) {
      let shadow = 1;
      if (this.uniforms.receiveShadows) {
        const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
        const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
        const faceNDotL = saturate(modelNormal.dot(this.uniforms.modelLightDir));
        const bias = minBias + (maxBias - minBias) * (1 - faceNDotL);
        shadow = lightSpacePos.z - bias > depth ? 0 : 1;
      }

      if (shadow > 0) {
        const halfDir = modelViewDir.add(modelLightDir).normalize();
        const nDotH = saturate(normal.x * halfDir.x + normal.y * halfDir.y + normal.z * halfDir.z);
        const vDotH = saturate(modelViewDir.dot(halfDir));
        const fresnelFactor = Math.pow(1 - saturate(vDotH), 5);
        const fresnelX = f0x + (1 - f0x) * fresnelFactor;
        const fresnelY = f0y + (1 - f0y) * fresnelFactor;
        const fresnelZ = f0z + (1 - f0z) * fresnelFactor;
        const distribution = distributionGGX(nDotH, roughness);
        const geometry = geometrySmith(nDotV, nDotL, roughness);
        const specularFactor = (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
        const diffuseFactor = (1 - metallic) * INV_PI;
        const lightScale = nDotL * lightIntensity;

        directR =
          ((1 - fresnelX) * diffuseFactor * baseColor.x + fresnelX * specularFactor) * lightScale;
        directG =
          ((1 - fresnelY) * diffuseFactor * baseColor.y + fresnelY * specularFactor) * lightScale;
        directB =
          ((1 - fresnelZ) * diffuseFactor * baseColor.z + fresnelZ * specularFactor) * lightScale;
      }
    }

    // Keep the direct-light PBR step readable with a tiny material-aware fill
    const ambientR = (baseColor.x * (1 - metallic) + f0x) * ambientIntensity * ambientOcclusion;
    const ambientG = (baseColor.y * (1 - metallic) + f0y) * ambientIntensity * ambientOcclusion;
    const ambientB = (baseColor.z * (1 - metallic) + f0z) * ambientIntensity * ambientOcclusion;

    return new Vector3(ambientR + directR, ambientG + directG, ambientB + directB);
  };
}
