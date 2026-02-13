import { DepthTexture, Texture } from "../drawing";
import { Vector2, Vector3, Vector4 } from "../maths";

export interface Verts {
  [key: string]: any;
}
export abstract class BaseShader {
  abstract uniforms?: { [key: string]: any };

  abstract vertex(): Vector4;
  abstract fragment(): Vector3 | void;

  vertexId = 0;
  nthVert = 0;
  bc = { u: 0, v: 0, w: 0 };
  fragPos = new Vector4();

  v2f = <T>(varying: Array<T>, value: T) => {
    varying[this.nthVert] = value;
  };

  varying = <T>(): Array<T> => {
    return Array<T>(3);
  };

  interpolate = (vals: number[]) => {
    return vals[0] * this.bc.u + vals[1] * this.bc.v + vals[2] * this.bc.w;
  };

  interpolateVec2 = (vals: Vector2[]) => {
    const x = this.interpolate([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolate([vals[0].y, vals[1].y, vals[2].y]);
    return new Vector2(x, y);
  };

  interpolateVec3 = (vals: Vector3[]) => {
    const x = this.interpolate([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolate([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolate([vals[0].z, vals[1].z, vals[2].z]);
    return new Vector3(x, y, z);
  };

  interpolateVec4 = (vals: Vector4[]) => {
    const x = this.interpolate([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolate([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolate([vals[0].z, vals[1].z, vals[2].z]);
    const w = this.interpolate([vals[0].w, vals[1].w, vals[2].w]);
    return new Vector4(x, y, z, w);
  };

  private toTexelCoord = (
    uv: Vector2 | Vector3 | Vector4,
    width: number,
    height: number,
  ) => {
    const x = Math.max(0, Math.min(width - 1, ~~(uv.x * width)));
    const y = Math.max(0, Math.min(height - 1, ~~((1 - uv.y) * height)));
    return { x, y };
  };

  sample = (texture: Texture, uv: Vector2): Vector3 => {
    const texel = this.toTexelCoord(uv, texture.width, texture.height);
    const index = texel.x + texel.y * texture.width;
    return texture.data[index].clone();
  };

  sampleDepth = (
    depthTexture: DepthTexture,
    uv: Vector2 | Vector3 | Vector4,
  ) => {
    const texel = this.toTexelCoord(uv, depthTexture.width, depthTexture.height);
    const index = texel.x + texel.y * depthTexture.width;
    return depthTexture.data[index];
  };
}
