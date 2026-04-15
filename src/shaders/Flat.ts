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
const baseColor = new Vector3(0.5, 0.5, 0.5);

export class FlatShader extends BaseShader<Uniforms> {
  // Flat shading stores one lighting value for the whole triangle.
  lighting = new Vector3();

  vertex = () => {
    const model = this.uniforms.model;

    // Use one shared lighting value for the whole triangle.
    if (this.nthVert === 0) {
      const worldNormal = this.uniforms.normalMat
        .transformDirection(model.faceNormals[this.vertexId])
        .normalize();
      const diffuse = Math.max(worldNormal.dot(this.uniforms.worldLightDir), 0);
      const lighting = diffuse + ambient;
      this.lighting = baseColor.scale(lighting);
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.lighting;
  };
}
