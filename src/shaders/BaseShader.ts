import { DepthTexture, Texture } from "../drawing";
import { clamp, Vector2, Vector3, Vector4 } from "../maths";

type VectorClass = typeof Vector2 | typeof Vector3 | typeof Vector4;

// What the vertex shader wrote for every vertex
export type Varying<C extends VectorClass = VectorClass> = {
  type: C;
  size: number;
  data: Float64Array;
};

export abstract class BaseShader<TUniforms = unknown> {
  declare uniforms: TUniforms;

  abstract vertex: () => Vector4;
  abstract fragment: (() => Vector3 | undefined) | undefined;

  vertexId = 0;
  // The triangle being drawn and its three vertices
  triangleId = 0;
  v0 = 0;
  v1 = 0;
  v2 = 0;
  bc = { u: 0, v: 0, w: 0 };
  pixelArea = 1;
  // -1 until pixelUvArea() works it out
  private trianglePixelUvArea = -1;

  private varyings: Varying[] = [];

  startTriangle = (pixelArea: number) => {
    this.pixelArea = pixelArea;
    this.trianglePixelUvArea = -1;
  };

  varying = <C extends VectorClass>(type: C): Varying<C> => {
    const varying = { type, size: type.size, data: new Float64Array(0) };
    this.varyings.push(varying);
    return varying;
  };

  // What vertex() returned for every vertex, after the perspective divide
  position = this.varying(Vector4);

  v2f = <C extends VectorClass>(varying: Varying<C>, value: InstanceType<C>) => {
    const data = varying.data;
    const size = varying.size;
    const offset = this.vertexId * size;
    data[offset] = value.x;
    data[offset + 1] = value.y;
    if (size > 2) data[offset + 2] = (value as Vector3).z;
    if (size > 3) data[offset + 3] = (value as Vector4).w;
  };

  // Makes room for every vertex's varyings
  resize = (vertexCount: number) => {
    if (this.position.data.length === vertexCount * 4) return;
    for (const varying of this.varyings) {
      varying.data = new Float64Array(vertexCount * varying.size);
    }
  };

  shadeVertex = (vertexId: number) => {
    this.vertexId = vertexId;
    this.v2f(this.position, this.vertex().perspectiveDivide());
  };

  // Vertex stage: runs the vertex shader once for every vertex
  shadeVertices = (vertexCount: number) => {
    this.resize(vertexCount);
    for (let vertexId = 0; vertexId < vertexCount; vertexId++) {
      this.shadeVertex(vertexId);
    }
  };

  // Points the shader at a triangle and copies its vertices' positions into verts
  assembleTriangle = (triangleId: number, indices: Uint32Array, verts: Vector4[]) => {
    this.triangleId = triangleId;
    this.v0 = indices[triangleId * 3];
    this.v1 = indices[triangleId * 3 + 1];
    this.v2 = indices[triangleId * 3 + 2];
    this.readPosition(this.v0, verts[0]);
    this.readPosition(this.v1, verts[1]);
    this.readPosition(this.v2, verts[2]);
  };

  private readPosition = (vertexId: number, out: Vector4) => {
    const data = this.position.data;
    const offset = vertexId * 4;
    out.x = data[offset];
    out.y = data[offset + 1];
    out.z = data[offset + 2];
    out.w = data[offset + 3];
  };

  interpolateVec2 = (varying: Varying<typeof Vector2>) => {
    const { u, v, w } = this.bc;
    const d = varying.data;
    const a = this.v0 * 2;
    const b = this.v1 * 2;
    const c = this.v2 * 2;
    return new Vector2(d[a] * u + d[b] * v + d[c] * w, d[a + 1] * u + d[b + 1] * v + d[c + 1] * w);
  };

  interpolateVec3 = (varying: Varying<typeof Vector3>) => {
    const { u, v, w } = this.bc;
    const d = varying.data;
    const a = this.v0 * 3;
    const b = this.v1 * 3;
    const c = this.v2 * 3;
    return new Vector3(
      d[a] * u + d[b] * v + d[c] * w,
      d[a + 1] * u + d[b + 1] * v + d[c + 1] * w,
      d[a + 2] * u + d[b + 2] * v + d[c + 2] * w,
    );
  };

  interpolateVec4 = (varying: Varying<typeof Vector4>) => {
    const { u, v, w } = this.bc;
    const d = varying.data;
    const a = this.v0 * 4;
    const b = this.v1 * 4;
    const c = this.v2 * 4;
    return new Vector4(
      d[a] * u + d[b] * v + d[c] * w,
      d[a + 1] * u + d[b + 1] * v + d[c + 1] * w,
      d[a + 2] * u + d[b + 2] * v + d[c + 2] * w,
      d[a + 3] * u + d[b + 3] * v + d[c + 3] * w,
    );
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

  // UV-space area covered by one pixel of the current triangle, for choosing a mipmap
  pixelUvArea = (uvs: Varying<typeof Vector2>) => {
    if (this.trianglePixelUvArea < 0) {
      const d = uvs.data;
      const a = this.v0 * 2;
      const b = this.v1 * 2;
      const c = this.v2 * 2;
      const uvArea =
        Math.abs((d[b] - d[a]) * (d[c + 1] - d[a + 1]) - (d[b + 1] - d[a + 1]) * (d[c] - d[a])) *
        0.5;
      this.trianglePixelUvArea = uvArea / this.pixelArea;
    }
    return this.trianglePixelUvArea;
  };

  sampleFiltered = (texture: Texture, uv: Vector2, pixelUvArea = 0): Vector3 => {
    const mipmap = texture.mipmapFor(pixelUvArea);
    const data = mipmap.data;
    const width = mipmap.width;
    const height = mipmap.height;
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
