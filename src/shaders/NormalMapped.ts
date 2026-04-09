import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  lightCol: Vector3;
  mCamPos: Vector3;
  orthographic: boolean;
  mViewDir: Vector3;
  texture: Texture;
  mLightDir: Vector3;
  normalTexture: Texture;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
  receiveShadows: boolean;
}

const specStr = 0.5;
const shininess = 32;
const ambient = 0.1;
const minBias = 0.001;
const maxBias = 0.005;

export class NormalMappedShader extends BaseShader {
  // Uniforms are set per draw call from `main.ts`.
  uniforms!: Uniforms;

  // Per-vertex data passed from vertex -> fragment.
  vUV = this.varying<Vector2>();
  vModelPos = this.varying<Vector3>();
  vNormal = this.varying<Vector3>();
  vTangent = this.varying<Vector4>();
  vLightSpacePos = this.varying<Vector3>();

  vertex = (): Vector4 => {
    // Read the source vertex attributes from the active mesh.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const modelPos = model.vertices[i];

    if (this.uniforms.receiveShadows) {
      const lightSpacePos =
        this.uniforms.lightSpaceMat.transformPoint(modelPos);
      lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
      lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
      this.v2f(this.vLightSpacePos, lightSpacePos);
    }

    // Emit varyings for interpolation across the triangle.
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vNormal, model.normals[i]);
    this.v2f(this.vTangent, model.tangents[i]);
    this.v2f(this.vModelPos, modelPos);

    // Final clip-space position for rasterization.
    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const uv = this.interpolateVec2(this.vUV);
    const modelPos = this.interpolateVec3(this.vModelPos);
    const mNormal = this.interpolateVec3(this.vNormal).normalize();
    const mTangent = this.interpolateVec4(this.vTangent);
    const handedness = mTangent.w < 0 ? -1 : 1;

    let shadow = 1;
    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
      const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
      const nDotL = Math.max(-mNormal.dot(this.uniforms.mLightDir), 0.0);
      const bias = minBias + (maxBias - minBias) * (1 - nDotL);
      shadow = lightSpacePos.z - bias > depth ? 0 : 1;
    }

    // Sample material inputs.
    const colour = this.sample(this.uniforms.texture, uv);
    const normalTS = this.sample(this.uniforms.normalTexture, uv);

    // Rebuild TBN in scalar form for performance.
    const tDotN = mTangent.dot3(mNormal);
    const Tx = mTangent.x - mNormal.x * tDotN;
    const Ty = mTangent.y - mNormal.y * tDotN;
    const Tz = mTangent.z - mNormal.z * tDotN;
    const TLengthSq = Tx * Tx + Ty * Ty + Tz * Tz;
    const TScale = TLengthSq > 0.000001 ? 1 / Math.sqrt(TLengthSq) : 0;
    const T = new Vector3(Tx * TScale, Ty * TScale, Tz * TScale);

    const Bx = (mNormal.y * T.z - mNormal.z * T.y) * handedness;
    const By = (mNormal.z * T.x - mNormal.x * T.z) * handedness;
    const Bz = (mNormal.x * T.y - mNormal.y * T.x) * handedness;
    const B = new Vector3(Bx, By, Bz);

    const Nx = T.x * normalTS.x + B.x * normalTS.y + mNormal.x * normalTS.z;
    const Ny = T.y * normalTS.x + B.y * normalTS.y + mNormal.y * normalTS.z;
    const Nz = T.z * normalTS.x + B.z * normalTS.y + mNormal.z * normalTS.z;
    const NLengthSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = NLengthSq > 1e-8 ? 1 / Math.sqrt(NLengthSq) : 0;
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

    // Blinn-Phong shading
    const lightDir = this.uniforms.mLightDir;
    const viewDir = this.uniforms.orthographic
      ? this.uniforms.mViewDir
      : this.uniforms.mCamPos.subtract(modelPos).normalize();
    const halfWayDir = viewDir.subtract(lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    const diffuse = Math.max(-normal.dot(lightDir), 0);
    const lighting = this.uniforms.lightCol.scale(
      (diffuse + spec) * shadow + ambient,
    );

    // Final lit color.
    return colour.multiplyInPlace(lighting);
  };
}
