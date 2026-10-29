import { Vector3, Matrix4 } from "../maths";
import { hash3 } from "../utils/hash";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  mvp: Matrix4;
}

const minColor = 0.25;
const totalColors = 16;

export class UnlitShader extends BaseShader<Uniforms> {
  color = new Vector3();

  vertex = () => {
    const model = this.uniforms.model;

    // Give each face a random color, seeded by its first vertex
    if (this.nthVert === 0) {
      this.color = hash3(this.vertexId % totalColors, minColor, 1);
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.color;
  };
}
