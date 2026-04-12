import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
}

const minColor = 0.125;

// Returns a random value for each face to give them distinct colors.
const hash = (x: number) => {
  x |= 0; // force 32-bit int
  x ^= x >>> 16;
  x = Math.imul(x, 0x7feb352d);
  x ^= x >>> 15;
  x = Math.imul(x, 0x846ca68b);
  x ^= x >>> 16;

  return minColor + ((x >>> 0) / 4294967295) * (1 - minColor);
};

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
      this.color = new Vector3(hash(i), hash(i + 1), hash(i + 2));
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[this.vertexId]);
  };

  fragment = () => {
    return this.color;
  };
}
