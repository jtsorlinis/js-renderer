import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export class PhongShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // Varyings
  vNormal = this.varying<Vector3>();

  vertex = (): Vector3 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const pos = this.uniforms.mvp.multPerspectiveDiv(model.vertices[i]);
    const normal = this.uniforms.normalMat.multiplyVector3(model.normals[i]);

    // Pass varyings to fragment shader
    this.v2f(this.vNormal, normal);

    return pos;
  };

  fragment = () => {
    // Get interpolated values
    const normal = this.interpolateVec3(this.vNormal);

    const intensity = -normal.dot(this.uniforms.lightDir);
    return this.uniforms.lightCol.scale(intensity);
  };
}
