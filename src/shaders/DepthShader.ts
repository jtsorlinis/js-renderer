import { Matrix4 } from "../maths";
import { BaseShader, Verts } from "./BaseShader";

export interface Uniforms {
  model: Verts;
  lightSpaceMat: Matrix4;
}

export class DepthShader extends BaseShader {
  uniforms!: Uniforms;

  vertex = () => {
    // Shadow pass only needs light-space clip coordinates.
    return this.uniforms.lightSpaceMat.multiplyPoint(
      this.uniforms.model.vertices[this.vertexId]
    );
  };

  // Depth comes from rasterized z, so no fragment color output is needed.
  fragment = () => {};
}
