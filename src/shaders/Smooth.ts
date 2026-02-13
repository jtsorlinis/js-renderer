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
}

const specStr = 0.25;
const shininess = 16;
const ambient = 0.1;
const smoothScale = 0.8;

export class SmoothShader extends BaseShader {
  // Uniforms are set per draw call.
  uniforms!: Uniforms;

  // Per-vertex values that will be interpolated in fragment().
  vNormal = this.varying<Vector3>();
  vWorldPos = this.varying<Vector4>();

  vertex = (): Vector4 => {
    // Read source mesh data.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const worldPos = this.uniforms.modelMat.multiplyPoint(model.vertices[i]);
    const normal = this.uniforms.normalMat
      .multiplyDirection(model.normals[i])
      .normalize();

    // Emit varyings.
    this.v2f(this.vNormal, normal);
    this.v2f(this.vWorldPos, worldPos);

    // Return clip-space position.
    return this.uniforms.mvp.multiplyPoint(model.vertices[i]);
  };

  fragment = () => {
    // Interpolated normal/position at this pixel.
    const normal = this.interpolateVec3(this.vNormal).normalize();
    const worldPos = this.interpolateVec4(this.vWorldPos);

    // Blinn-Phong lighting on a flat white material.
    const viewDir = this.uniforms.camPos.subtract(worldPos.xyz).normalize();
    const halfWayDir = viewDir.subtract(this.uniforms.lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    const diffuse = Math.max(-normal.dot(this.uniforms.lightDir), 0);
    const litAmount = diffuse + spec + ambient;
    return this.uniforms.lightCol.scale(litAmount * smoothScale);
  };
}
