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
  bcClip = { u: 0, v: 0, w: 0 };
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

  interpolateVec3Persp = (vals: Vector3[]) => {
    const x = this.interpolatePersp([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolatePersp([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolatePersp([vals[0].z, vals[1].z, vals[2].z]);
    return new Vector3(x, y, z);
  };

  interpolateVec4 = (vals: Vector4[]) => {
    const x = this.interpolate([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolate([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolate([vals[0].z, vals[1].z, vals[2].z]);
    const w = this.interpolate([vals[0].w, vals[1].w, vals[2].w]);
    return new Vector4(x, y, z, w);
  };

  interpolateVec4Persp = (vals: Vector4[]) => {
    const x = this.interpolatePersp([vals[0].x, vals[1].x, vals[2].x]);
    const y = this.interpolatePersp([vals[0].y, vals[1].y, vals[2].y]);
    const z = this.interpolatePersp([vals[0].z, vals[1].z, vals[2].z]);
    const w = this.interpolatePersp([vals[0].w, vals[1].w, vals[2].w]);
    return new Vector4(x, y, z, w);
  };

  sample = (texture: Texture, uv: Vector2): Vector3 => {
    const x = ~~(uv.x * texture.width);
    const y = ~~((1 - uv.y) * texture.height);
    const index = x + y * texture.width;
    return texture.data[index].clone();
  };

  sampleBilinear = (texture: Texture, uv: Vector2): Vector3 => {
    const x = uv.x * texture.width;
    const y = (1 - uv.y) * texture.height;
    const x1 = ~~x;
    const y1 = ~~y;
    const x2 = x1 + 1;
    const y2 = y1 + 1;
    const dx = x - x1;
    const dy = y - y1;
    const c1 = texture.data[x1 + y1 * texture.width].clone();
    const c2 = texture.data[x2 + y1 * texture.width].clone();
    const c3 = texture.data[x1 + y2 * texture.width].clone();
    const c4 = texture.data[x2 + y2 * texture.width].clone();
    const c12 = c1.scaleInPlace(1 - dx).addInPlace(c2.scaleInPlace(dx));
    const c34 = c3.scaleInPlace(1 - dx).addInPlace(c4.scaleInPlace(dx));
    return c12.scaleInPlace(1 - dy).addInPlace(c34.scaleInPlace(dy));
  };

  sampleNormal = (texture: Texture, uv: Vector2): Vector3 => {
    const normal = this.sample(texture, uv);
    normal.x = normal.x * 2 - 1;
    normal.y = normal.y * 2 - 1;
    normal.z = normal.z * 2 - 1;
    return normal;
  };

  sampleNormalBilinear = (texture: Texture, uv: Vector2): Vector3 => {
    const normal = this.sampleBilinear(texture, uv);
    normal.x = normal.x * 2 - 1;
    normal.y = normal.y * 2 - 1;
    normal.z = normal.z * 2 - 1;
    return normal;
  };

  sampleDepth = (
    depthTexture: DepthTexture,
    uv: Vector2 | Vector3 | Vector4
  ) => {
    const x = ~~(uv.x * depthTexture.width);
    const y = ~~((1 - uv.y) * depthTexture.height);
    const index = x + y * depthTexture.width;
    return depthTexture.data[index];
  };
}
