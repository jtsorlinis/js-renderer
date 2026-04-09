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
  modelLightDir: Vector3;
  modelCamPos: Vector3;
  orthographic: boolean;
  modelViewDir: Vector3;
  texture: Texture;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
  receiveShadows: boolean;
}

const minBias = 0.001;
const maxBias = 0.005;
const lightIntensity = 3.14;

const ambientIntensity = 0.1;

// Direct-light PBR stage shown before the renderer adds image-based lighting.
export class PbrShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector3>();
  vModelPos = this.varying<Vector3>();
  vNormal = this.varying<Vector3>();
  vTangent = this.varying<Vector4>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];
    const modelPos = model.vertices[i];

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vModelPos, modelPos);
    this.v2f(this.vNormal, normal);
    this.v2f(this.vTangent, tangent);

    if (this.uniforms.receiveShadows) {
      const lightSpacePos =
        this.uniforms.lightSpaceMat.transformPoint(modelPos);
      lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
      lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
      this.v2f(this.vLightSpacePos, lightSpacePos);
    }

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const modelPos = this.interpolateVec3(this.vModelPos);
    const mNormal = this.interpolateVec3(this.vNormal).normalize();
    const mTangent = this.interpolateVec4(this.vTangent);
    const handedness = mTangent.w < 0 ? -1 : 1;
    let shadow = 1;
    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
      const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
      const faceNDotL = saturate(-mNormal.dot(this.uniforms.modelLightDir));
      const bias = minBias + (maxBias - minBias) * (1 - faceNDotL);
      shadow = lightSpacePos.z - bias > depth ? 0 : 1;
    }

    const tDotN = mTangent.dot3(mNormal);
    const Tx = mTangent.x - mNormal.x * tDotN;
    const Ty = mTangent.y - mNormal.y * tDotN;
    const Tz = mTangent.z - mNormal.z * tDotN;
    const TLenSq = Tx * Tx + Ty * Ty + Tz * Tz;
    const TScale = TLenSq > EPSILON ? 1 / Math.sqrt(TLenSq) : 0;
    const T = new Vector3(Tx * TScale, Ty * TScale, Tz * TScale);

    const Bx = (mNormal.y * T.z - mNormal.z * T.y) * handedness;
    const By = (mNormal.z * T.x - mNormal.x * T.z) * handedness;
    const Bz = (mNormal.x * T.y - mNormal.y * T.x) * handedness;

    const normalTS = this.sample(this.uniforms.normalTexture, uv);
    const Nx = T.x * normalTS.x + Bx * normalTS.y + mNormal.x * normalTS.z;
    const Ny = T.y * normalTS.x + By * normalTS.y + mNormal.y * normalTS.z;
    const Nz = T.z * normalTS.x + Bz * normalTS.y + mNormal.z * normalTS.z;
    const NLenSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = NLenSq > EPSILON ? 1 / Math.sqrt(NLenSq) : 0;
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

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

    const lightDir = this.uniforms.modelLightDir.scale(-1);
    const viewDir = this.uniforms.orthographic
      ? this.uniforms.modelViewDir
      : this.uniforms.modelCamPos.subtract(modelPos).normalize();
    const nDotL = saturate(
      normal.x * lightDir.x + normal.y * lightDir.y + normal.z * lightDir.z,
    );
    const nDotV = saturate(
      normal.x * viewDir.x + normal.y * viewDir.y + normal.z * viewDir.z,
    );
    const halfDir = lightDir.add(viewDir);

    let directR = 0;
    let directG = 0;
    let directB = 0;
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      halfDir.normalize();
      const nDotH = saturate(
        normal.x * halfDir.x + normal.y * halfDir.y + normal.z * halfDir.z,
      );
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

    // Keep the direct-light PBR step readable with a tiny material-aware fill
    const ambientR = (baseColor.x * (1 - metallic) + f0x) * ambientIntensity;
    const ambientG = (baseColor.y * (1 - metallic) + f0y) * ambientIntensity;
    const ambientB = (baseColor.z * (1 - metallic) + f0z) * ambientIntensity;

    return new Vector3(
      ambientR + directR,
      ambientG + directG,
      ambientB + directB,
    );
  };
}
