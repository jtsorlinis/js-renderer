import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture } from "../drawing";
import { Material } from "../materials/Material";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  modelCamPos: Vector3;
  modelLightDir: Vector3;
  lightSpaceMat: Matrix4;
  material: Material;
  shadowMap: DepthTexture;
  receiveShadows: boolean;
}

const specularStrength = 0.5;
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
  vModelNormal = this.varying<Vector3>();
  vModelTangent = this.varying<Vector4>();
  vLightSpacePos = this.varying<Vector3>();

  vertex = () => {
    // Read the source vertex attributes from the active mesh.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const modelPos = model.vertices[i];

    // Emit varyings for interpolation across the triangle.
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vModelNormal, model.normals[i]);
    this.v2f(this.vModelTangent, model.tangents[i]);
    this.v2f(this.vModelPos, modelPos);

    // Shadow mapping if enabled
    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
      lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
      lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
      this.v2f(this.vLightSpacePos, lightSpacePos);
    }

    // Final clip-space position for rasterization.
    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const uv = this.interpolateVec2(this.vUV);
    const modelPos = this.interpolateVec3(this.vModelPos);
    const modelNormal = this.interpolateVec3(this.vModelNormal).normalize();
    const modelTangent = this.interpolateVec4(this.vModelTangent);
    const handedness = modelTangent.w < 0 ? -1 : 1;

    // Sample material inputs.
    const color = this.sample(this.uniforms.material.colorTexture, uv);
    const normalTexel = this.sample(this.uniforms.material.normalTexture, uv);

    // Rebuild TBN in scalar form for performance.
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
    const B = new Vector3(Bx, By, Bz);

    const Nx = T.x * normalTexel.x + B.x * normalTexel.y + modelNormal.x * normalTexel.z;
    const Ny = T.y * normalTexel.x + B.y * normalTexel.y + modelNormal.y * normalTexel.z;
    const Nz = T.z * normalTexel.x + B.z * normalTexel.y + modelNormal.z * normalTexel.z;
    const NLengthSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = 1 / Math.sqrt(NLengthSq);
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

    // Shadow mapping if enabled
    let shadow = 1;
    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
      const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
      const nDotL = Math.max(modelNormal.dot(this.uniforms.modelLightDir), 0.0);
      const bias = minBias + (maxBias - minBias) * (1 - nDotL);
      shadow = lightSpacePos.z - bias > depth ? 0 : 1;
    }

    // Blinn-Phong shading
    const modelLightDir = this.uniforms.modelLightDir;
    const viewDir = this.uniforms.modelCamPos.subtract(modelPos).normalize();
    const halfwayDir = viewDir.add(modelLightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfwayDir), 0), shininess);
    spec *= specularStrength;
    const diffuse = Math.max(normal.dot(modelLightDir), 0);
    const lighting = (diffuse + spec) * shadow + ambient;

    // Final lit color.
    return color.scaleInPlace(lighting);
  };
}
