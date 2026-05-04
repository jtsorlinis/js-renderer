import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture } from "../drawing";
import { Material } from "../materials/Material";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  mvp: Matrix4;
  modelMat: Matrix4;
  normalMat: Matrix4;
  worldLightDir: Vector3;
  worldCamPos: Vector3;
  orthographic: boolean;
  worldViewDir: Vector3;
  worldLightSpaceMat: Matrix4;
  material: Material;
  shadowMap: DepthTexture;
  receiveShadows: boolean;
}

const specularStrength = 0.25;
const shininess = 32;
const ambient = 0.1;
const minBias = 0.001;
const maxBias = 0.005;

export class NormalMappedShader extends BaseShader<Uniforms> {
  // Per-vertex data passed from vertex -> fragment.
  vUV = this.varying<Vector2>();
  vWorldPos = this.varying<Vector3>();
  vWorldNormal = this.varying<Vector3>();
  vWorldTangent = this.varying<Vector4>();
  vLightSpacePos = this.varying<Vector3>();

  vertex = () => {
    // Read the source vertex attributes from the active mesh.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const modelPos = model.vertices[i];
    const worldPos = this.uniforms.modelMat.transformPoint(modelPos);
    const worldNormal = this.uniforms.normalMat.transformDirection(model.normals[i]).normalize();
    const worldTangent = this.uniforms.modelMat.transformDirection4(model.tangents[i]).normalize3();

    // Emit varyings for interpolation across the triangle.
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vWorldNormal, worldNormal);
    this.v2f(this.vWorldTangent, worldTangent);
    this.v2f(this.vWorldPos, worldPos);

    // Shadow mapping if enabled
    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.uniforms.worldLightSpaceMat.transformPoint(worldPos);
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
    const worldPos = this.interpolateVec3(this.vWorldPos);
    const worldNormal = this.interpolateVec3(this.vWorldNormal).normalize();
    const worldTangent = this.interpolateVec4(this.vWorldTangent);
    const handedness = worldTangent.w < 0 ? -1 : 1;

    // Sample material inputs.
    const color = this.sampleFiltered(this.uniforms.material.colorTexture, uv);
    const normalTexel = this.sampleFiltered(this.uniforms.material.normalTexture, uv);

    // Rebuild TBN in scalar form for performance.
    const tDotN = worldTangent.dot3(worldNormal);
    const Tx = worldTangent.x - worldNormal.x * tDotN;
    const Ty = worldTangent.y - worldNormal.y * tDotN;
    const Tz = worldTangent.z - worldNormal.z * tDotN;
    const TLengthSq = Tx * Tx + Ty * Ty + Tz * Tz;
    const TScale = 1 / Math.sqrt(TLengthSq);
    const T = new Vector3(Tx * TScale, Ty * TScale, Tz * TScale);

    const Bx = (worldNormal.y * T.z - worldNormal.z * T.y) * handedness;
    const By = (worldNormal.z * T.x - worldNormal.x * T.z) * handedness;
    const Bz = (worldNormal.x * T.y - worldNormal.y * T.x) * handedness;
    const B = new Vector3(Bx, By, Bz);

    const Nx = T.x * normalTexel.x + B.x * normalTexel.y + worldNormal.x * normalTexel.z;
    const Ny = T.y * normalTexel.x + B.y * normalTexel.y + worldNormal.y * normalTexel.z;
    const Nz = T.z * normalTexel.x + B.z * normalTexel.y + worldNormal.z * normalTexel.z;
    const NLengthSq = Nx * Nx + Ny * Ny + Nz * Nz;
    const NScale = 1 / Math.sqrt(NLengthSq);
    const normal = new Vector3(Nx * NScale, Ny * NScale, Nz * NScale);

    // Shadow mapping if enabled
    let shadow = 1;
    if (this.uniforms.receiveShadows) {
      const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
      const nDotL = Math.max(normal.dot(this.uniforms.worldLightDir), 0.0);
      const bias = minBias + (maxBias - minBias) * (1 - nDotL);
      shadow = this.sampleShadow(this.uniforms.shadowMap, lightSpacePos, bias);
    }

    // Blinn-Phong shading
    const worldLightDir = this.uniforms.worldLightDir;
    const viewDir = this.uniforms.orthographic
      ? this.uniforms.worldViewDir
      : this.uniforms.worldCamPos.subtract(worldPos).normalize();
    const halfwayDir = viewDir.add(worldLightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfwayDir), 0), shininess);
    spec *= specularStrength;
    const diffuse = Math.max(normal.dot(worldLightDir), 0);
    const finalColor = color
      .scaleInPlace(diffuse * shadow + ambient)
      .addScalarInPlace(spec * shadow);

    // Final lit color.
    return finalColor;
  };
}
