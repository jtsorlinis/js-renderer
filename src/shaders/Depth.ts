import { Matrix4 } from "../maths";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  clipMat: Matrix4;
}

export class DepthShader extends BaseShader<Uniforms> {
  vertex = () => {
    // Depth-only passes only need clip-space coordinates.
    return this.uniforms.clipMat.transformPoint4(this.uniforms.model.vertices[this.vertexId]);
  };

  // Depth comes from rasterized z, so no fragment color output is needed.
  fragment = undefined;
}
