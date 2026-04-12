import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4 } from "../maths";
import { rand } from "../utils/random";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
}

const minColor = 0.25;

export class UnlitShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  color = new Vector3();

  vertex = () => {
    const model = this.uniforms.model;
    const faceId = Math.floor(this.vertexId / 3);
    const i = faceId * 3;

    // Give each face a random color
    if (this.nthVert === 0) {
      const r = rand(i, minColor, 1);
      const g = rand(i + 1, minColor, 1);
      const b = rand(i + 2, minColor, 1);
      this.color = new Vector3(r, g, b);
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.color;
  };
}
