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

const minColour = 0.125;

// Returns a random value for each face to give them distinct colours.
const hash = (x: number) => {
  x |= 0; // force 32-bit int
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;

  return minColour + ((x >>> 0) / 4294967295) * (1 - minColour);
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
    return this.uniforms.mvp.projectPoint(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.colour;
  };
}
