import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector2 } from "../maths";
import { Material } from "../materials/Material";

export interface Uniforms {
  model: Verts;
  modelMat: Matrix4;
  mvp: Matrix4;
  normalMat: Matrix4;
  worldLightDir: Vector3;
  worldCamPos: Vector3;
  orthographic: boolean;
  worldViewDir: Vector3;
  material: Material;
}

const specularStrength = 0.5;
const shininess = 32;
const ambient = 0.1;

export class TexturedShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  // Varyings are interpolated per pixel in fragment().
  vWorldNormal = this.varying<Vector3>();
  vWorldPos = this.varying<Vector3>();
  vUV = this.varying<Vector2>();

  vertex = () => {
    // Load source vertex data.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const worldPos = this.uniforms.modelMat.transformPoint(model.vertices[i]);
    const worldNormal = this.uniforms.normalMat.transformDirection(model.normals[i]).normalize();

    // Emit per-vertex values to be interpolated over the triangle.
    this.v2f(this.vWorldNormal, worldNormal);
    this.v2f(this.vWorldPos, worldPos);
    this.v2f(this.vUV, model.uvs[i]);

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[i]);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const worldNormal = this.interpolateVec3(this.vWorldNormal).normalize();
    const worldPos = this.interpolateVec3(this.vWorldPos);
    const uv = this.interpolateVec2(this.vUV);

    // Sample albedo texture.
    const baseColor = this.sample(this.uniforms.material.colorTexture, uv);

    // Basic Blinn-Phong lighting in world space.
    const worldViewDir = this.uniforms.orthographic
      ? this.uniforms.worldViewDir
      : this.uniforms.worldCamPos.subtract(worldPos).normalize();
    const halfwayDir = worldViewDir.subtract(this.uniforms.worldLightDir).normalize();
    let spec = Math.pow(Math.max(worldNormal.dot(halfwayDir), 0), shininess);
    spec *= specularStrength;
    const diffuse = Math.max(-worldNormal.dot(this.uniforms.worldLightDir), 0);
    const lighting = diffuse + spec + ambient;

    return baseColor.scaleInPlace(lighting);
  };
}
