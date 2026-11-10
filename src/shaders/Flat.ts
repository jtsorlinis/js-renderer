import { Vector3, Matrix4 } from "../maths";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  mvp: Matrix4;
  normalMat: Matrix4;
  worldLightDir: Vector3;
}

const ambient = 0.1;
const baseColor = Vector3.One.scale(0.5);

export class FlatShader extends BaseShader<Uniforms> {
  vertex = () => {
    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(this.uniforms.model.vertices[this.vertexId]);
  };

  fragment = () => {
    // Flat shading lights every pixel of a triangle with its face normal.
    const worldNormal = this.uniforms.normalMat
      .transformDirection(this.uniforms.model.faceNormals[this.triangleId])
      .normalize();
    const diffuse = Math.max(worldNormal.dot(this.uniforms.worldLightDir), 0);
    const lighting = diffuse + ambient;
    return baseColor.scale(lighting);
  };
}
