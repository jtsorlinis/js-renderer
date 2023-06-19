import { Matrix4 } from "../maths";
import { BaseShader, Verts } from "./BaseShader";

export interface Uniforms {
  model: Verts;
  lightSpaceMat: Matrix4;
}

export class DepthShader extends BaseShader {
  uniforms!: Uniforms;

  vDepth = this.varying<number>();

  vertex = () => {
    const i = this.vertexId;
    const pos = this.uniforms.lightSpaceMat.multiplyPoint(
      this.uniforms.model.vertices[i]
    );
    return pos;
  };

  fragment = () => {};
}
