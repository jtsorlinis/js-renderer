import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  camPos: Vector3;
}

// Returns a random value in [0.25, 1] for each face to give them distinct colours.
const hash = (x: number) => {
  const s = Math.sin(x * 12.9898) * 43758.5453;
  return 0.25 + (s - Math.floor(s)) * 0.75;
};

export class UnlitShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  colour = new Vector3();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const faceId = Math.floor(this.vertexId / 3);
    const i = faceId * 3;

    // Give each face a random colour
    this.colour = new Vector3(hash(i), hash(i + 1), hash(i + 2));

    // Return clip-space position.
    return this.uniforms.mvp.multiplyPoint(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.colour;
  };
}
