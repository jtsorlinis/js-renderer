import { BaseShader } from "./BaseShader";
import { Barycentric, interpolate3 } from "../drawing/triangle";
import { Vector3, Matrix4 } from "../maths";

export interface Uniforms {
  mvp: Matrix4;
  rotMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export class PhongShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // Varyings
  normal = Array(3).fill(new Vector3());

  vertex = (i: number, nthVert: number): Vector3 => {
    const pos = this.uniforms.mvp.multPerspectiveDiv(this.model.vertices[i]);
    this.normal[nthVert] = this.uniforms.rotMat.multiplyVector3(
      this.model.normals[i]
    );

    return pos;
  };

  fragment = (bc: Barycentric) => {
    const varyingNormal = interpolate3(this.normal, bc);
    const intensity = -varyingNormal.dot(this.uniforms.lightDir);
    return this.uniforms.lightCol.scale(intensity);
  };
}
