import { Texture } from "../drawing";
import { Vector2, Vector3, Vector4 } from "../maths";
import type { Material } from "../materials/Material";
import type { IblData } from "../shaders/iblHelpers";
import type { FrameRenderState, RenderSettings, StaticRenderScene } from "../renderer/renderCore";
import type { Mesh } from "../utils/mesh";
import type { BufferRegion } from "../drawing/Framebuffer";

type Vec3Tuple = [number, number, number];

export interface SerializedTexture {
  data: Float32Array;
  width: number;
  height: number;
}

export interface SerializedMaterial {
  colorTexture: SerializedTexture;
  normalTexture: SerializedTexture;
  metallicRoughnessTexture: SerializedTexture;
  colorFactor: Vec3Tuple;
  metallicFactor: number;
  roughnessFactor: number;
}

export interface SerializedMesh {
  vertices: Float32Array;
  normals: Float32Array;
  faceNormals: Float32Array;
  uvs: Float32Array;
  tangents: Float32Array;
}

export interface SerializedIblData extends IblData {}

export interface SerializedSceneBase {
  fullWidth: number;
  fullHeight: number;
  shadowMapSize: number;
  fov: number;
  model: SerializedMesh;
  material: SerializedMaterial;
  iblData: SerializedIblData;
  lightDir: Vec3Tuple;
  envYaw: { sin: number; cos: number };
  shadowOrthoSize: number;
}

export interface SerializedScene extends SerializedSceneBase {
  backgroundData: Uint8ClampedArray;
}

export interface SerializedFrameState {
  modelPos: Vec3Tuple;
  modelRotation: Vec3Tuple;
  modelScale: Vec3Tuple;
  camPos: Vec3Tuple;
  viewDir: Vec3Tuple;
  aspectRatio: number;
  orthoSize: number;
  isOrtho: boolean;
  renderSettings: RenderSettings;
}

export interface ConfigureWorkerMessage {
  type: "configure";
  sceneVersion: number;
  tile: BufferRegion;
  scene: SerializedScene;
}

export interface RenderWorkerMessage {
  type: "render";
  sceneVersion: number;
  frameId: number;
  frame: SerializedFrameState;
  outputBuffer: ArrayBuffer;
  triangleVertexIndices: Uint32Array;
  shadowMapBuffer?: ArrayBuffer;
}

export type WorkerRequestMessage = ConfigureWorkerMessage | RenderWorkerMessage;

export interface WorkerConfiguredMessage {
  type: "configured";
  sceneVersion: number;
}

export interface WorkerRenderedMessage {
  type: "rendered";
  sceneVersion: number;
  frameId: number;
  tile: BufferRegion;
  pixels: Uint8ClampedArray;
  shadowMapBuffer?: Float32Array;
  renderTimeMs: number;
}

export interface WorkerErrorMessage {
  type: "error";
  message: string;
  sceneVersion?: number;
  frameId?: number;
}

export type WorkerResponseMessage =
  | WorkerConfiguredMessage
  | WorkerRenderedMessage
  | WorkerErrorMessage;

const serializeVector2Array = (values: Vector2[]) => {
  const data = new Float32Array(values.length * 2);
  for (let i = 0; i < values.length; i += 1) {
    const base = i * 2;
    data[base] = values[i].x;
    data[base + 1] = values[i].y;
  }
  return data;
};

const serializeVector3Array = (values: Vector3[]) => {
  const data = new Float32Array(values.length * 3);
  for (let i = 0; i < values.length; i += 1) {
    const base = i * 3;
    data[base] = values[i].x;
    data[base + 1] = values[i].y;
    data[base + 2] = values[i].z;
  }
  return data;
};

const serializeVector4Array = (values: Vector4[]) => {
  const data = new Float32Array(values.length * 4);
  for (let i = 0; i < values.length; i += 1) {
    const base = i * 4;
    data[base] = values[i].x;
    data[base + 1] = values[i].y;
    data[base + 2] = values[i].z;
    data[base + 3] = values[i].w;
  }
  return data;
};

const deserializeVector2Array = (values: Float32Array) => {
  const result: Vector2[] = [];
  for (let i = 0; i < values.length; i += 2) {
    result.push(new Vector2(values[i], values[i + 1]));
  }
  return result;
};

const deserializeVector3Array = (values: Float32Array) => {
  const result: Vector3[] = [];
  for (let i = 0; i < values.length; i += 3) {
    result.push(new Vector3(values[i], values[i + 1], values[i + 2]));
  }
  return result;
};

const deserializeVector4Array = (values: Float32Array) => {
  const result: Vector4[] = [];
  for (let i = 0; i < values.length; i += 4) {
    result.push(new Vector4(values[i], values[i + 1], values[i + 2], values[i + 3]));
  }
  return result;
};

const serializeTexture = (texture: Texture): SerializedTexture => {
  return {
    data: texture.data,
    width: texture.width,
    height: texture.height,
  };
};

const deserializeTexture = (texture: SerializedTexture) => {
  return new Texture(texture.data, texture.width, texture.height);
};

export const serializeStaticScene = (
  scene: StaticRenderScene,
  fullWidth: number,
  fullHeight: number,
  shadowMapSize: number,
  fov: number,
): SerializedSceneBase => {
  return {
    fullWidth,
    fullHeight,
    shadowMapSize,
    fov,
    model: {
      vertices: serializeVector3Array(scene.model.vertices),
      normals: serializeVector3Array(scene.model.normals),
      faceNormals: serializeVector3Array(scene.model.faceNormals),
      uvs: serializeVector2Array(scene.model.uvs),
      tangents: serializeVector4Array(scene.model.tangents),
    },
    material: {
      colorTexture: serializeTexture(scene.material.colorTexture),
      normalTexture: serializeTexture(scene.material.normalTexture),
      metallicRoughnessTexture: serializeTexture(scene.material.metallicRoughnessTexture),
      colorFactor: [
        scene.material.colorFactor.x,
        scene.material.colorFactor.y,
        scene.material.colorFactor.z,
      ],
      metallicFactor: scene.material.metallicFactor,
      roughnessFactor: scene.material.roughnessFactor,
    },
    iblData: {
      diffuseIrradianceMap: scene.iblData.diffuseIrradianceMap,
      diffuseIrradianceMapWidth: scene.iblData.diffuseIrradianceMapWidth,
      diffuseIrradianceMapHeight: scene.iblData.diffuseIrradianceMapHeight,
      specularPrefilterMap: scene.iblData.specularPrefilterMap,
      specularPrefilterMapWidth: scene.iblData.specularPrefilterMapWidth,
      specularPrefilterMapHeight: scene.iblData.specularPrefilterMapHeight,
      specularPrefilterLayerStride: scene.iblData.specularPrefilterLayerStride,
      specularPrefilterRoughnessLutSize: scene.iblData.specularPrefilterRoughnessLutSize,
      specularPrefilterRoughnessMaxIndex: scene.iblData.specularPrefilterRoughnessMaxIndex,
      specularBrdfLut: scene.iblData.specularBrdfLut,
      specularBrdfLutSize: scene.iblData.specularBrdfLutSize,
      specularBrdfLutMaxIndex: scene.iblData.specularBrdfLutMaxIndex,
    },
    lightDir: [scene.lightDir.x, scene.lightDir.y, scene.lightDir.z],
    envYaw: scene.envYaw,
    shadowOrthoSize: scene.shadowOrthoSize,
  };
};

export const deserializeStaticScene = (scene: SerializedSceneBase): StaticRenderScene => {
  const mesh: Mesh = {
    vertices: deserializeVector3Array(scene.model.vertices),
    normals: deserializeVector3Array(scene.model.normals),
    faceNormals: deserializeVector3Array(scene.model.faceNormals),
    uvs: deserializeVector2Array(scene.model.uvs),
    tangents: deserializeVector4Array(scene.model.tangents),
  };

  const material: Material = {
    colorTexture: deserializeTexture(scene.material.colorTexture),
    normalTexture: deserializeTexture(scene.material.normalTexture),
    metallicRoughnessTexture: deserializeTexture(scene.material.metallicRoughnessTexture),
    colorFactor: new Vector3(...scene.material.colorFactor),
    metallicFactor: scene.material.metallicFactor,
    roughnessFactor: scene.material.roughnessFactor,
  };

  return {
    model: mesh,
    material,
    iblData: scene.iblData,
    lightDir: new Vector3(...scene.lightDir),
    envYaw: scene.envYaw,
    shadowOrthoSize: scene.shadowOrthoSize,
  };
};

export const serializeFrameState = (frame: FrameRenderState): SerializedFrameState => {
  return {
    modelPos: [frame.modelPos.x, frame.modelPos.y, frame.modelPos.z],
    modelRotation: [frame.modelRotation.x, frame.modelRotation.y, frame.modelRotation.z],
    modelScale: [frame.modelScale.x, frame.modelScale.y, frame.modelScale.z],
    camPos: [frame.camPos.x, frame.camPos.y, frame.camPos.z],
    viewDir: [frame.viewDir.x, frame.viewDir.y, frame.viewDir.z],
    aspectRatio: frame.aspectRatio,
    orthoSize: frame.orthoSize,
    isOrtho: frame.isOrtho,
    renderSettings: frame.renderSettings,
  };
};

export const deserializeFrameState = (frame: SerializedFrameState): FrameRenderState => {
  return {
    modelPos: new Vector3(...frame.modelPos),
    modelRotation: new Vector3(...frame.modelRotation),
    modelScale: new Vector3(...frame.modelScale),
    camPos: new Vector3(...frame.camPos),
    viewDir: new Vector3(...frame.viewDir),
    aspectRatio: frame.aspectRatio,
    orthoSize: frame.orthoSize,
    isOrtho: frame.isOrtho,
    renderSettings: frame.renderSettings,
  };
};

export const extractRegionRgba = (
  rgba: Uint8ClampedArray,
  fullWidth: number,
  region: BufferRegion,
) => {
  const result = new Uint8ClampedArray(region.width * region.height * 4);
  const rowWidth = region.width * 4;
  for (let y = 0; y < region.height; y += 1) {
    const srcStart = ((region.y + y) * fullWidth + region.x) * 4;
    const destStart = y * rowWidth;
    result.set(rgba.subarray(srcStart, srcStart + rowWidth), destStart);
  }
  return result;
};

export const blitRegionRgba = (
  target: Uint8ClampedArray,
  targetWidth: number,
  region: BufferRegion,
  pixels: Uint8ClampedArray,
) => {
  const rowWidth = region.width * 4;
  for (let y = 0; y < region.height; y += 1) {
    const destStart = ((region.y + y) * targetWidth + region.x) * 4;
    const srcStart = y * rowWidth;
    target.set(pixels.subarray(srcStart, srcStart + rowWidth), destStart);
  }
};
