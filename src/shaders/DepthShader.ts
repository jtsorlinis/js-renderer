import { Matrix4 } from "../maths";
import { BaseShader, Verts } from "./BaseShader";

export interface Uniforms {
  model: Verts;
  lightSpaceMat: Matrix4;
}

export class DepthShader extends BaseShader {
  uniforms!: Uniforms;

  vertex = () => {
    return this.uniforms.lightSpaceMat.multiplyPoint(
      this.uniforms.model.vertices[this.vertexId]
    );
  };

  fragment = () => {};
}
