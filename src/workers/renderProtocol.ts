import { Texture } from "../drawing";
import { Vector2, Vector3, Vector4 } from "../maths";
import type { Material } from "../materials/Material";
import type { RenderSelectionPreset } from "../renderSettings";
import type { IblData } from "../shaders/shaderHelpers";
import type { Mesh } from "../utils/mesh";

// Messages between TiledWorkerRenderer (main thread) and renderWorker. Class instances lose their
// prototypes when posted, so meshes and textures travel as typed arrays and are rebuilt on arrival.
// Those arrays live in shared memory (SharedArrayBuffer), so every worker reads the same copy.

type Vec3Tuple = [number, number, number];

// A full-width run of rows [y, y + height) of the frame
export interface Band {
  y: number;
  height: number;
}

// One entry per mipmap, starting with the texture itself
type SerializedTexture = {
  data: Float32Array;
  width: number;
  height: number;
}[];

export interface SerializedScene {
  model: {
    vertices: Float32Array;
    normals: Float32Array;
    uvs: Float32Array;
    tangents: Float32Array;
    indices: Uint32Array;
    faceNormals: Float32Array;
  };
  material: {
    colorTexture: SerializedTexture;
    normalTexture: SerializedTexture;
    ormTexture: SerializedTexture;
    metallicFactor: number;
    occlusionStrength: number;
    roughnessFactor: number;
  };
  iblData: IblData;
  envYaw: { sin: number; cos: number };
  lightDir: Vec3Tuple;
  viewDir: Vec3Tuple;
}

// Sent whenever the model, material or resolution changes
export interface ConfigureMessage {
  type: "configure";
  width: number;
  height: number;
  // Every band of the frame. Workers take them in turn using nextBand.
  bands: Band[];
  nextBand: Int32Array;
  scene: SerializedScene;
  // Full-frame environment backdrops
  background: Uint8ClampedArray;
  backgroundTonemapped: Uint8ClampedArray;
  // The frame every worker writes its bands into
  pixels: Uint8ClampedArray;
  // Rendered by the main thread before each frame's render messages are sent
  shadowMap: Float32Array;
  shadowMapSize: number;
}

export interface FrameMatrices {
  modelMat: Float32Array;
  normalMat: Float32Array;
  mvp: Float32Array;
  worldLightSpaceMat: Float32Array;
}

export interface RenderMessage {
  type: "render";
  settings: RenderSelectionPreset;
  matrices: FrameMatrices;
  camPos: Vec3Tuple;
  orthographic: boolean;
  // The triangles touching each band, packed band by band. Band b's
  // triangles are triangles[bandStarts[b]] up to triangles[bandStarts[b + 1]].
  triangles: Uint32Array;
  bandStarts: Uint32Array;
}

export type WorkerRequest = ConfigureMessage | RenderMessage;

export const toTuple = (v: Vector3): Vec3Tuple => [v.x, v.y, v.z];

// Copies every typed array in value into shared memory. Posting the result to workers then gives
// them all the same memory, where an ordinary typed array would be copied for each one.
export const shareMemory = <T>(value: T): T => {
  if (ArrayBuffer.isView(value)) {
    const array = value as unknown as Uint8Array;
    const TypedArray = array.constructor as Uint8ArrayConstructor;
    const shared = new TypedArray(new SharedArrayBuffer(array.byteLength));
    shared.set(array);
    return shared as unknown as T;
  }
  if (Array.isArray(value)) {
    return value.map((item) => shareMemory(item)) as T;
  }
  if (value && typeof value === "object") {
    const entries = Object.entries(value).map(([key, item]) => [key, shareMemory(item)]);
    return Object.fromEntries(entries) as T;
  }
  return value;
};

const packVector2s = (values: Vector2[]) => {
  const data = new Float32Array(values.length * 2);
  for (let i = 0; i < values.length; i++) {
    data[i * 2] = values[i].x;
    data[i * 2 + 1] = values[i].y;
  }
  return data;
};

const packVector3s = (values: Vector3[]) => {
  const data = new Float32Array(values.length * 3);
  for (let i = 0; i < values.length; i++) {
    data[i * 3] = values[i].x;
    data[i * 3 + 1] = values[i].y;
    data[i * 3 + 2] = values[i].z;
  }
  return data;
};

const packVector4s = (values: Vector4[]) => {
  const data = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i++) {
    data[i * 4] = values[i].x;
    data[i * 4 + 1] = values[i].y;
    data[i * 4 + 2] = values[i].z;
    data[i * 4 + 3] = values[i].w;
  }
  return data;
};

const unpackVector2s = (data: Float32Array) => {
  const values: Vector2[] = [];
  for (let i = 0; i < data.length; i += 2) {
    values.push(new Vector2(data[i], data[i + 1]));
  }
  return values;
};

const unpackVector3s = (data: Float32Array) => {
  const values: Vector3[] = [];
  for (let i = 0; i < data.length; i += 3) {
    values.push(new Vector3(data[i], data[i + 1], data[i + 2]));
  }
  return values;
};

const unpackVector4s = (data: Float32Array) => {
  const values: Vector4[] = [];
  for (let i = 0; i < data.length; i += 4) {
    values.push(new Vector4(data[i], data[i + 1], data[i + 2], data[i + 3]));
  }
  return values;
};

const packTexture = (texture: Texture): SerializedTexture =>
  texture.mipmaps.map(({ data, width, height }) => ({ data, width, height }));

const unpackTexture = (serialized: SerializedTexture) => {
  const mipmaps = serialized.map(({ data, width, height }) => new Texture(data, width, height));
  mipmaps[0].mipmaps = mipmaps;
  return mipmaps[0];
};

export const serializeScene = (
  model: Mesh,
  material: Material,
  iblData: IblData,
  envYaw: { sin: number; cos: number },
  lightDir: Vector3,
  viewDir: Vector3,
): SerializedScene => ({
  model: {
    vertices: packVector3s(model.vertices),
    normals: packVector3s(model.normals),
    uvs: packVector2s(model.uvs),
    tangents: packVector4s(model.tangents),
    indices: model.indices,
    faceNormals: packVector3s(model.faceNormals),
  },
  material: {
    colorTexture: packTexture(material.colorTexture),
    normalTexture: packTexture(material.normalTexture),
    ormTexture: packTexture(material.ormTexture),
    metallicFactor: material.metallicFactor,
    occlusionStrength: material.occlusionStrength,
    roughnessFactor: material.roughnessFactor,
  },
  iblData,
  envYaw,
  lightDir: toTuple(lightDir),
  viewDir: toTuple(viewDir),
});

export const deserializeScene = (scene: SerializedScene) => {
  const model: Mesh = {
    vertices: unpackVector3s(scene.model.vertices),
    normals: unpackVector3s(scene.model.normals),
    uvs: unpackVector2s(scene.model.uvs),
    tangents: unpackVector4s(scene.model.tangents),
    indices: scene.model.indices,
    faceNormals: unpackVector3s(scene.model.faceNormals),
  };
  const material: Material = {
    colorTexture: unpackTexture(scene.material.colorTexture),
    normalTexture: unpackTexture(scene.material.normalTexture),
    ormTexture: unpackTexture(scene.material.ormTexture),
    metallicFactor: scene.material.metallicFactor,
    occlusionStrength: scene.material.occlusionStrength,
    roughnessFactor: scene.material.roughnessFactor,
  };
  return {
    model,
    material,
    iblData: scene.iblData,
    envYaw: scene.envYaw,
    lightDir: new Vector3(...scene.lightDir),
    viewDir: new Vector3(...scene.viewDir),
  };
};
