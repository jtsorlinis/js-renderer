import { Matrix4 } from "../maths";
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
  vertex = () => {
    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(this.uniforms.model.vertices[this.vertexId]);
  };

  fragment = () => {
    // Give each face one of a few random colors. hash3 uses three seeds in a row.
    return hash3((this.triangleId * 3) % totalColors, minColor, 1);
  };
}
