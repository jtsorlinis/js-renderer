import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4 } from "../maths";

export interface Uniforms {
  model: Verts;
  modelMat: Matrix4;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  camPos: Vector3;
  orthographic: boolean;
  worldViewDir: Vector3;
}

const specularStrength = 0.5;
const shininess = 32;
const ambient = 0.1;
const baseColor = new Vector3(0.5, 0.5, 0.5);

export class SmoothShader extends BaseShader {
  // Uniforms are set per draw call.
  uniforms!: Uniforms;

  // Per-vertex values that will be interpolated in fragment().
  vWorldNormal = this.varying<Vector3>();
  vWorldPos = this.varying<Vector3>();

  vertex = (): Vector4 => {
    // Read source mesh data.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const worldPos = this.uniforms.modelMat.transformPoint(model.vertices[i]);
    const worldNormal = this.uniforms.normalMat
      .transformDirection(model.normals[i])
      .normalize();

    // Emit varyings.
    this.v2f(this.vWorldNormal, worldNormal);
    this.v2f(this.vWorldPos, worldPos);

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[i]);
  };

  fragment = () => {
    // Interpolated normal/position at this pixel.
    const worldNormal = this.interpolateVec3(this.vWorldNormal).normalize();
    const worldPos = this.interpolateVec3(this.vWorldPos);

    // Blinn-Phong lighting on a flat white material.
    const viewDir = this.uniforms.orthographic
      ? this.uniforms.worldViewDir
      : this.uniforms.camPos.subtract(worldPos).normalize();
    const halfwayDir = viewDir.subtract(this.uniforms.lightDir).normalize();
    let spec = Math.pow(Math.max(worldNormal.dot(halfwayDir), 0), shininess);
    spec *= specularStrength;
    const diffuse = Math.max(-worldNormal.dot(this.uniforms.lightDir), 0);
    const lighting = this.uniforms.lightCol.scale(diffuse + spec + ambient);
    return baseColor.multiply(lighting);
  };
}
