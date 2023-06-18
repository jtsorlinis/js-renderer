import { Vector2, Vector3, Vector4 } from "../maths";

export interface Verts {
  [key: string]: any;
}
export abstract class BaseShader {
  abstract uniforms?: { [key: string]: any };

  abstract vertex(): Vector4;
  abstract fragment(): Vector3 | undefined;

  vertexId = 0;
  nthVert = 0;
  bc = { u: 0, v: 0, w: 0 };
  bcClip = { u: 0, v: 0, w: 0 };

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
    return (
      vals[0] * this.bcClip.u +
      vals[1] * this.bcClip.v +
      vals[2] * this.bcClip.w
    );
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
}
