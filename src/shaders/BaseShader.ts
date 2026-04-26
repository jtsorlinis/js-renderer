import { DepthTexture, Texture } from "../drawing";
import { clamp, Vector2, Vector3, Vector4 } from "../maths";

export abstract class BaseShader<TUniforms = unknown> {
  declare uniforms: TUniforms;

  abstract vertex: () => Vector4;
  abstract fragment: (() => Vector3 | undefined) | undefined;

  vertexId = 0;
  nthVert = 0;
  bc = { u: 0, v: 0, w: 0 };
  fragPos = new Vector3();

  v2f = <T>(varying: Array<T>, value: T) => {
    varying[this.nthVert] = value;
  };

  varying = <T>(): Array<T> => {
    return Array<T>(3);
  };

  interpolate = (a: number, b: number, c: number) => {
    return a * this.bc.u + b * this.bc.v + c * this.bc.w;
  };

  interpolateVec2 = (vals: Vector2[]) => {
    const x = this.interpolate(vals[0].x, vals[1].x, vals[2].x);
    const y = this.interpolate(vals[0].y, vals[1].y, vals[2].y);
    return new Vector2(x, y);
  };

  interpolateVec3 = (vals: Vector3[]) => {
    const x = this.interpolate(vals[0].x, vals[1].x, vals[2].x);
    const y = this.interpolate(vals[0].y, vals[1].y, vals[2].y);
    const z = this.interpolate(vals[0].z, vals[1].z, vals[2].z);
    return new Vector3(x, y, z);
  };

  interpolateVec4 = (vals: Vector4[]) => {
    const x = this.interpolate(vals[0].x, vals[1].x, vals[2].x);
    const y = this.interpolate(vals[0].y, vals[1].y, vals[2].y);
    const z = this.interpolate(vals[0].z, vals[1].z, vals[2].z);
    const w = this.interpolate(vals[0].w, vals[1].w, vals[2].w);
    return new Vector4(x, y, z, w);
  };

  private toTexelIndex = (uv: Vector2 | Vector3 | Vector4, width: number, height: number) => {
    const x = Math.max(0, Math.min(width - 1, ~~(uv.x * width)));
    const y = Math.max(0, Math.min(height - 1, ~~((1 - uv.y) * height)));
    return x + y * width;
  };

  sample = (texture: Texture, uv: Vector2): Vector3 => {
    const texel = this.toTexelIndex(uv, texture.width, texture.height);
    const index = texel * 3;
    return new Vector3(texture.data[index], texture.data[index + 1], texture.data[index + 2]);
  };

  sampleFiltered = (texture: Texture, uv: Vector2): Vector3 => {
    const xCoord = uv.x * texture.width - 0.5;
    const yCoord = (1 - uv.y) * texture.height - 0.5;
    const x0 = Math.floor(xCoord);
    const y0 = Math.floor(yCoord);
    const xBlend = xCoord - x0;
    const yBlend = yCoord - y0;
    const xIndex0 = clamp(x0, 0, texture.width - 1);
    const yIndex0 = clamp(y0, 0, texture.height - 1);
    const xIndex1 = clamp(x0 + 1, 0, texture.width - 1);
    const yIndex1 = clamp(y0 + 1, 0, texture.height - 1);
    const rowStride = texture.width * 3;
    const base00 = yIndex0 * rowStride + xIndex0 * 3;
    const base10 = yIndex0 * rowStride + xIndex1 * 3;
    const base01 = yIndex1 * rowStride + xIndex0 * 3;
    const base11 = yIndex1 * rowStride + xIndex1 * 3;
    const r0 = texture.data[base00] + (texture.data[base10] - texture.data[base00]) * xBlend;
    const r1 = texture.data[base01] + (texture.data[base11] - texture.data[base01]) * xBlend;
    const g0 =
      texture.data[base00 + 1] + (texture.data[base10 + 1] - texture.data[base00 + 1]) * xBlend;
    const g1 =
      texture.data[base01 + 1] + (texture.data[base11 + 1] - texture.data[base01 + 1]) * xBlend;
    const b0 =
      texture.data[base00 + 2] + (texture.data[base10 + 2] - texture.data[base00 + 2]) * xBlend;
    const b1 =
      texture.data[base01 + 2] + (texture.data[base11 + 2] - texture.data[base01 + 2]) * xBlend;
    return new Vector3(r0 + (r1 - r0) * yBlend, g0 + (g1 - g0) * yBlend, b0 + (b1 - b0) * yBlend);
  };

  sampleDepth = (depthTexture: DepthTexture, uv: Vector2 | Vector3 | Vector4) => {
    const texel = this.toTexelIndex(uv, depthTexture.width, depthTexture.height);
    return depthTexture.data[texel];
  };

  sampleShadow = (depthTexture: DepthTexture, lightSpacePos: Vector3, bias: number) => {
    const compareDepth = lightSpacePos.z - bias;
    const centerX = Math.floor(lightSpacePos.x * depthTexture.width);
    const centerY = Math.floor((1 - lightSpacePos.y) * depthTexture.height);

    let litSamples = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const iy = Math.max(0, Math.min(depthTexture.height - 1, centerY + offsetY));
      for (let offsetX = -1; offsetX <= 1; offsetX++) {
        const ix = Math.max(0, Math.min(depthTexture.width - 1, centerX + offsetX));
        litSamples += compareDepth <= depthTexture.data[ix + iy * depthTexture.width] ? 1 : 0;
      }
    }

    return litSamples / 9;
  };
}
