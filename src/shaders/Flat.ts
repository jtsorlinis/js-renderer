import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  rotMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export class FlatShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // Attributes
  intensity = 0;

  vertex = (): Vector3 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const pos = this.uniforms.mvp.multPerspectiveDiv(model.vertices[i]);
    const normal = this.uniforms.rotMat.multiplyVector3(model.flatNormals[i]);
    this.intensity = -normal.dot(this.uniforms.lightDir);

    return pos;
  };

  fragment = () => {
    return this.uniforms.lightCol.scale(this.intensity);
  };
}
