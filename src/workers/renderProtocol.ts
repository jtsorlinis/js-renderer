import { Texture } from "../drawing";
import { Vector2, Vector3, Vector4 } from "../maths";
import type { Material } from "../materials/Material";
import type { RenderSelection } from "../renderSettings";
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

interface SerializedTexture {
  data: Float32Array;
  width: number;
  height: number;
}

// One mesh attribute: each distinct vector once, plus which one every triangle corner uses.
// Corners that share a vertex then share one object in the worker instead of each getting a copy.
interface SharedVectors {
  values: Float32Array;
  index: Uint32Array;
}

export interface SerializedScene {
  model: {
    vertices: SharedVectors;
    normals: SharedVectors;
    faceNormals: SharedVectors;
    uvs: SharedVectors;
    tangents: SharedVectors;
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
  // Full-frame environment backdrop
  background: Uint8ClampedArray;
  // The frame every worker writes its bands into. It still holds the previous frame when a render
  // message arrives, which the vector fade draws on top of.
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
  settings: RenderSelection;
  matrices: FrameMatrices;
  camPos: Vec3Tuple;
  // Seconds since the previous frame, for the vector fade
  dt: number;
  // First vertex index of each triangle touching each band, packed band by band. Band b's
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

// Finds the distinct vectors in packed (size floats each) by comparing exact bit patterns, so
// values arrive unchanged. Uses a small open-addressing hash table: a Map with string keys is ~20x
// slower, which would stall the main thread for ~0.4s when switching to a 100k triangle model.
const shareVectors = (packed: Float32Array, size: number): SharedVectors => {
  const count = packed.length / size;
  const bits = new Uint32Array(packed.buffer, packed.byteOffset, packed.length);
  const tableSize = 2 ** Math.ceil(Math.log2(count * 2 + 1));
  const table = new Int32Array(tableSize).fill(-1); // slot -> distinct vector id, -1 when empty
  const firstCorner = new Uint32Array(count); // distinct vector id -> first corner using it
  const index = new Uint32Array(count);
  let distinct = 0;

  for (let corner = 0; corner < count; corner++) {
    const offset = corner * size;
    let hash = 0x811c9dc5;
    for (let c = 0; c < size; c++) {
      hash = Math.imul(hash ^ bits[offset + c], 0x01000193);
    }

    let slot = hash & (tableSize - 1);
    while (true) {
      const id = table[slot];
      if (id === -1) {
        table[slot] = distinct;
        firstCorner[distinct] = corner;
        index[corner] = distinct++;
        break;
      }
      const existing = firstCorner[id] * size;
      let same = true;
      for (let c = 0; c < size; c++) {
        same &&= bits[existing + c] === bits[offset + c];
      }
      if (same) {
        index[corner] = id;
        break;
      }
      slot = (slot + 1) & (tableSize - 1);
    }
  }

  const values = new Float32Array(distinct * size);
  for (let id = 0; id < distinct; id++) {
    const start = firstCorner[id] * size;
    values.set(packed.subarray(start, start + size), id * size);
  }
  return { values, index };
};

// One entry per corner again, with corners that share a vector pointing at the same object
const unshareVectors = <T>(shared: SharedVectors, unpack: (data: Float32Array) => T[]) => {
  const distinct = unpack(shared.values);
  return Array.from(shared.index, (id) => distinct[id]);
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

const packTexture = ({ data, width, height }: Texture): SerializedTexture => ({
  data,
  width,
  height,
});

const unpackTexture = ({ data, width, height }: SerializedTexture) =>
  new Texture(data, width, height);

export const serializeScene = (
  model: Mesh,
  material: Material,
  iblData: IblData,
  envYaw: { sin: number; cos: number },
  lightDir: Vector3,
): SerializedScene => ({
  model: {
    vertices: shareVectors(packVector3s(model.vertices), 3),
    normals: shareVectors(packVector3s(model.normals), 3),
    faceNormals: shareVectors(packVector3s(model.faceNormals), 3),
    uvs: shareVectors(packVector2s(model.uvs), 2),
    tangents: shareVectors(packVector4s(model.tangents), 4),
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
  envYaw: { sin: envYaw.sin, cos: envYaw.cos },
  lightDir: toTuple(lightDir),
});

export const deserializeScene = (scene: SerializedScene) => {
  const model: Mesh = {
    vertices: unshareVectors(scene.model.vertices, unpackVector3s),
    normals: unshareVectors(scene.model.normals, unpackVector3s),
    faceNormals: unshareVectors(scene.model.faceNormals, unpackVector3s),
    uvs: unshareVectors(scene.model.uvs, unpackVector2s),
    tangents: unshareVectors(scene.model.tangents, unpackVector4s),
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
  };
};
