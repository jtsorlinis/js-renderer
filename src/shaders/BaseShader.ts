import { Vector2, Vector3 } from "../maths";

export interface Verts {
  [key: string]: any;
}
export abstract class BaseShader {
  abstract uniforms?: { [key: string]: any };

  abstract vertex(): Vector3;
  abstract fragment(): Vector3 | undefined;

  vertexId = 0;
  nthVert = 0;
  bc = { u: 0, v: 0, w: 0 };
  w = [0, 0, 0];

  v2f = <T>(varying: Array<T>, value: T) => {
    varying[this.nthVert] = value;
  };

  varying = <T>(): Array<T> => {
    return Array<T>(3);
  };

  interpolate = (vals: number[]) => {
    return vals[0] * this.bc.u + vals[1] * this.bc.v + vals[2] * this.bc.w;
  };

  interpolatePersp = (vals: number[]) => {
    const overW0 = (vals[0] / this.w[0]) * this.bc.u;
    const overW1 = (vals[1] / this.w[1]) * this.bc.v;
    const overW2 = (vals[2] / this.w[2]) * this.bc.w;
    const overWSum = overW0 + overW1 + overW2;

    const wRecip0 = (1 / this.w[0]) * this.bc.u;
    const wRecip1 = (1 / this.w[1]) * this.bc.v;
    const wRecip2 = (1 / this.w[2]) * this.bc.w;
    const wRecipSum = wRecip0 + wRecip1 + wRecip2;

    return overWSum / wRecipSum;
  };

  interpolateVec2 = (vals: Vector2[]) => {
    const x = this.interpolate([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolate([vals[0].y, vals[1].y, vals[2].y]);
    return new Vector2(x, y);
  };

  interpolateVec2Persp = (vals: Vector2[]) => {
    const x = this.interpolatePersp([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolatePersp([vals[0].y, vals[1].y, vals[2].y]);
    return new Vector2(x, y);
  };

  interpolateVec3 = (vals: Vector3[]) => {
    const x = this.interpolate([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolate([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolate([vals[0].z, vals[1].z, vals[2].z]);
    return new Vector3(x, y, z);
  };

  interpolateVec3Persp = (vals: Vector3[]) => {
    const x = this.interpolatePersp([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolatePersp([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolatePersp([vals[0].z, vals[1].z, vals[2].z]);
    return new Vector3(x, y, z);
  };
}
