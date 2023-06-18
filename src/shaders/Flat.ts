import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export class FlatShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // No interpolation needed for flat shading
  intensity = 0;

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const pos = this.uniforms.mvp.multiplyPoint(model.vertices[i]);
    const normal = this.uniforms.normalMat
      .multiplyDirection(model.faceNormals[i])
      .normalize();

    this.intensity = -normal.dot(this.uniforms.lightDir);

    return pos;
  };

  fragment = () => {
    return this.uniforms.lightCol.scale(this.intensity);
  };
}
