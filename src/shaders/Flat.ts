import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4 } from "../maths";

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

  vertex = (): Vector3 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const pos = this.uniforms.mvp.multPerspectiveDiv(model.vertices[i]);
    const norm = this.uniforms.normalMat.multiplyVector3(model.flatNormals[i]);
    this.intensity = -norm.dot(this.uniforms.lightDir);

    return pos;
  };

  fragment = () => {
    return this.uniforms.lightCol.scale(this.intensity);
  };
}
