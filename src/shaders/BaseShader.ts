import { Vector3 } from "../maths";
import { Barycentric } from "../drawing/triangle";

export interface Verts {
  [key: string]: any;
}
export abstract class BaseShader {
  model: Verts;
  abstract uniforms?: { [key: string]: any };

  constructor(model: Verts) {
    this.model = model;
  }

  abstract vertex(i: number, nthVert: number): Vector3;
  abstract fragment(bc: Barycentric): Vector3 | undefined;
}

export const varying = <T>(): Array<T> => {
  return Array<T>(3);
};

export const v2f = <T>(varying: Array<T>, value: T, nthVert: number) => {
  varying[nthVert] = value;
};
