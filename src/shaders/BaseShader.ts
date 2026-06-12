import { DepthTexture, Texture } from "../drawing";
import { clamp, Vector2, Vector3, Vector4 } from "../maths";

export abstract class BaseShader<TUniforms = unknown> {
  declare uniforms: TUniforms;

  abstract vertex: () => Vector4;
  abstract fragment: (() => Vector3 | undefined) | undefined;

  vertexId = 0;
  nthVert = 0;
  bc = { u: 0, v: 0, w: 0 };

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
    const data = texture.data;
    const width = texture.width;
    const height = texture.height;
    const xCoord = uv.x * width - 0.5;
    const yCoord = (1 - uv.y) * height - 0.5;
    const x0 = Math.floor(xCoord);
    const y0 = Math.floor(yCoord);
    const xBlend = xCoord - x0;
    const yBlend = yCoord - y0;
    const rowStride = width * 3;
    const xOffset0 = clamp(x0, 0, width - 1) * 3;
    const xOffset1 = clamp(x0 + 1, 0, width - 1) * 3;
    const rowOffset0 = clamp(y0, 0, height - 1) * rowStride;
    const rowOffset1 = clamp(y0 + 1, 0, height - 1) * rowStride;
    const base00 = rowOffset0 + xOffset0;
    const base10 = rowOffset0 + xOffset1;
    const base01 = rowOffset1 + xOffset0;
    const base11 = rowOffset1 + xOffset1;
    const r00 = data[base00];
    const g00 = data[base00 + 1];
    const b00 = data[base00 + 2];
    const r01 = data[base01];
    const g01 = data[base01 + 1];
    const b01 = data[base01 + 2];
    const r0 = r00 + (data[base10] - r00) * xBlend;
    const r1 = r01 + (data[base11] - r01) * xBlend;
    const g0 = g00 + (data[base10 + 1] - g00) * xBlend;
    const g1 = g01 + (data[base11 + 1] - g01) * xBlend;
    const b0 = b00 + (data[base10 + 2] - b00) * xBlend;
    const b1 = b01 + (data[base11 + 2] - b01) * xBlend;
    return new Vector3(r0 + (r1 - r0) * yBlend, g0 + (g1 - g0) * yBlend, b0 + (b1 - b0) * yBlend);
  };

  sampleDepth = (depthTexture: DepthTexture, uv: Vector2 | Vector3 | Vector4) => {
    const texel = this.toTexelIndex(uv, depthTexture.width, depthTexture.height);
    return depthTexture.data[texel];
  };

  sampleShadow = (depthTexture: DepthTexture, lightSpacePos: Vector3, bias: number) => {
    const data = depthTexture.data;
    const width = depthTexture.width;
    const compareDepth = lightSpacePos.z - bias;
    const centerX = Math.floor(lightSpacePos.x * width);
    const centerY = Math.floor((1 - lightSpacePos.y) * depthTexture.height);

    const x0 = Math.max(0, Math.min(width - 1, centerX - 1));
    const x1 = Math.max(0, Math.min(width - 1, centerX));
    const x2 = Math.max(0, Math.min(width - 1, centerX + 1));

    let litSamples = 0;
    for (let offsetY = -1; offsetY <= 1; offsetY++) {
      const iy = Math.max(0, Math.min(depthTexture.height - 1, centerY + offsetY));
      const rowBase = iy * width;
      litSamples += compareDepth <= data[rowBase + x0] ? 1 : 0;
      litSamples += compareDepth <= data[rowBase + x1] ? 1 : 0;
      litSamples += compareDepth <= data[rowBase + x2] ? 1 : 0;
    }

    return litSamples / 9;
  };
}
