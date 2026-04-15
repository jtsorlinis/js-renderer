import { Vector3, Matrix4 } from "../maths";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  mvp: Matrix4;
}

const SNES_PALETTE = [
  new Vector3(0.13, 0.16, 0.3),
  new Vector3(0.2, 0.33, 0.56),
  new Vector3(0.29, 0.55, 0.56),
  new Vector3(0.48, 0.71, 0.39),
  new Vector3(0.82, 0.76, 0.35),
  new Vector3(0.8, 0.49, 0.24),
  new Vector3(0.67, 0.3, 0.28),
  new Vector3(0.72, 0.68, 0.79),
  new Vector3(0.48, 0.71, 0.39),
] as const;

export class UnlitShader extends BaseShader<Uniforms> {
  color = SNES_PALETTE[0];

  vertex = () => {
    const model = this.uniforms.model;
    const faceId = Math.floor(this.vertexId / 3);

    // Give each face a color from a fixed low-color palette.
    if (this.nthVert === 0) {
      this.color = SNES_PALETTE[faceId % SNES_PALETTE.length];
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.color;
  };
}
