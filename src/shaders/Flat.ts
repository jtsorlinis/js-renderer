import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

const ambient = 0.04;
const lightScale = 0.75;

export class FlatShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  // Flat shading stores one lighting value for the whole triangle.
  lighting = new Vector3();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;

    // Use one shared lighting value for the whole triangle.
    if (this.nthVert === 0) {
      const normal = this.uniforms.normalMat
        .transformDirection(model.faceNormals[this.vertexId])
        .normalize();
      const diffuse = Math.max(-normal.dot(this.uniforms.lightDir), 0);
      const lightStrength = (diffuse + ambient) * lightScale;
      this.lighting = this.uniforms.lightCol.scale(lightStrength);
    }

    // Return clip-space position.
    return this.uniforms.mvp.projectPoint(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.lighting;
  };
}
