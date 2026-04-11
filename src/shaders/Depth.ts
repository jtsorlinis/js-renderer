import { Matrix4 } from "../maths";
import { BaseShader, Verts } from "./BaseShader";

export interface Uniforms {
  model: Verts;
  clipMat: Matrix4;
}

export class DepthShader extends BaseShader {
  uniforms!: Uniforms;

  vertex = () => {
    // Depth-only passes only need clip-space coordinates.
    return this.uniforms.clipMat.transformPoint4(this.uniforms.model.vertices[this.vertexId]);
  };

  // Depth comes from rasterized z, so no fragment color output is needed.
  fragment = undefined;
}
