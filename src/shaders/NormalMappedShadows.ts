import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  lightCol: Vector3;
  mCamPos: Vector3;
  texture: Texture;
  mLightDir: Vector3;
  normalTexture: Texture;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

const specStr = 0.5;
const shininess = 32;
const ambient = 0.1;
const shadowBias = 0.01;

export class NormalMappedShadowsShader extends BaseShader {
  // Uniforms are set per draw call from `main.ts`.
  uniforms!: Uniforms;

  // Per-vertex data passed from vertex -> fragment.
  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector3>();
  vModelPos = this.varying<Vector3>();
  vNormal = this.varying<Vector3>();
  vTangent = this.varying<Vector4>();

  vertex = (): Vector4 => {
    // Read the source vertex attributes from the active mesh.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const modelPos = model.vertices[i];

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    // Emit varyings for interpolation across the triangle.
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vNormal, model.normals[i]);
    this.v2f(this.vTangent, model.tangents[i]);
    this.v2f(this.vModelPos, modelPos);
    this.v2f(this.vLightSpacePos, lightSpacePos);

    // Final clip-space position for rasterization.
    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const uv = this.interpolateVec2(this.vUV);
    const modelPos = this.interpolateVec3(this.vModelPos);
    const vNormal = this.interpolateVec3(this.vNormal).normalize();
    const vTangent = this.interpolateVec4(this.vTangent);
    const handedness = vTangent.w < 0 ? -1 : 1;
    const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);

    // Manual depth-compare shadowing.
    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    // Sample material inputs.
    const colour = this.sample(this.uniforms.texture, uv);
    const normalTS = this.sample(this.uniforms.normalTexture, uv);

    // Rebuild TBN in scalar form for performance.
    const tDotN = vTangent.dot3(vNormal);
    const Tx = vTangent.x - vNormal.x * tDotN;
    const Ty = vTangent.y - vNormal.y * tDotN;
    const Tz = vTangent.z - vNormal.z * tDotN;
    const TLengthSq = Tx * Tx + Ty * Ty + Tz * Tz;
    const TScale = TLengthSq > 0.000001 ? 1 / Math.sqrt(TLengthSq) : 0;
    const T = new Vector3(Tx * TScale, Ty * TScale, Tz * TScale);

    const Bx = (vNormal.y * T.z - vNormal.z * T.y) * handedness;
    const By = (vNormal.z * T.x - vNormal.x * T.z) * handedness;
    const Bz = (vNormal.x * T.y - vNormal.y * T.x) * handedness;
    const B = new Vector3(Bx, By, Bz);

    const Nx = T.x * normalTS.x + B.x * normalTS.y + vNormal.x * normalTS.z;
    const Ny = T.y * normalTS.x + B.y * normalTS.y + vNormal.y * normalTS.z;
    const Nz = T.z * normalTS.x + B.z * normalTS.y + vNormal.z * normalTS.z;
    const NLengthSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = NLengthSq > 1e-8 ? 1 / Math.sqrt(NLengthSq) : 0;
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

    // Blinn-Phong shading
    const lightDir = this.uniforms.mLightDir;
    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const halfWayDir = viewDir.subtractInPlace(lightDir).normalize();
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
