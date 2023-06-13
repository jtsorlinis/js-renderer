import { BaseShader, Verts, v2f, varying } from "./BaseShader";
import { Barycentric, interpolate3 } from "../drawing/triangle";
import { Vector3, Matrix4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  rotMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export class PhongShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // Varyings
  vNormal = varying<Vector3>();

  vertex = (i: number, nthVert: number): Vector3 => {
    const model = this.uniforms.model;
    const pos = this.uniforms.mvp.multPerspectiveDiv(model.vertices[i]);
    const normal = this.uniforms.rotMat.multiplyVector3(model.normals[i]);

    // Pass varyings to fragment shader
    v2f(this.vNormal, normal, nthVert);

    return pos;
  };

  fragment = (bc: Barycentric) => {
    const normal = interpolate3(this.vNormal, bc);
    const intensity = -normal.dot(this.uniforms.lightDir);
    return this.uniforms.lightCol.scale(intensity);
  };
}
