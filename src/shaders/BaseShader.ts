import { Vector3 } from "../maths";
import { Model } from "../utils/objLoader";
import { Barycentric } from "../drawing/triangle";

export abstract class BaseShader {
  model: Model;
  abstract uniforms?: { [key: string]: any };

  constructor(model: Model) {
    this.model = model;
  }

  abstract vertex(i: number, nthVert: number): Vector3;
  abstract fragment(bc: Barycentric): Vector3 | undefined;
}
