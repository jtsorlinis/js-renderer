import { Texture, type TextureDescriptor } from "../drawing";
import { Matrix4, Vector2, Vector3 } from "../maths";
import { buildLoadedModel, type LoadedModel } from "./mesh";

type Gltf = {
  accessors?: GltfAccessor[];
  bufferViews?: GltfBufferView[];
  images?: GltfImage[];
  materials?: GltfMaterial[];
  meshes?: GltfMesh[];
  nodes?: GltfNode[];
  scene?: number;
  scenes?: GltfScene[];
  textures?: GltfTexture[];
};

type GltfAccessor = {
  bufferView?: number;
  byteOffset?: number;
  componentType: number;
  count: number;
  normalized?: boolean;
  sparse?: unknown;
  type: "SCALAR" | "VEC2" | "VEC3" | "VEC4";
};

type GltfBufferView = {
  buffer?: number;
  byteLength: number;
  byteOffset?: number;
  byteStride?: number;
};

type GltfImage = {
  bufferView?: number;
  mimeType?: string;
  uri?: string;
};

type GltfMaterial = {
  normalTexture?: GltfTextureInfo;
  pbrMetallicRoughness?: {
    baseColorFactor?: number[];
    baseColorTexture?: GltfTextureInfo;
    metallicFactor?: number;
    metallicRoughnessTexture?: GltfTextureInfo;
    roughnessFactor?: number;
  };
};

type GltfMesh = {
  primitives: GltfPrimitive[];
};

type GltfNode = {
  children?: number[];
  matrix?: number[];
  mesh?: number;
  rotation?: [number, number, number, number];
  scale?: [number, number, number];
  translation?: [number, number, number];
};

type GltfPrimitive = {
  attributes: {
    NORMAL?: number;
    POSITION?: number;
    TEXCOORD_0?: number;
    [key: string]: number | undefined;
  };
  indices?: number;
  material?: number;
  mode?: number;
};

type GltfScene = {
  nodes?: number[];
};

type GltfTexture = {
  source?: number;
};

type GltfTextureInfo = {
  index: number;
  texCoord?: number;
};

type PrimitiveInstance = {
  primitive: GltfPrimitive;
  worldMatrix: Matrix4;
};

type ParsedGlb = {
  json: Gltf;
  binaryChunk: ArrayBuffer;
};

type ConvertedGlb = {
  mesh: LoadedModel;
  baseColorTextureIndex?: number;
  normalTextureIndex?: number;
  pbrMaterial: {
    baseColorFactor: Vector3;
    metallicFactor: number;
    metallicRoughnessTextureIndex?: number;
    roughnessFactor: number;
  };
};

const GLB_MAGIC = 0x46546c67;
const GLB_VERSION = 2;
const JSON_CHUNK_TYPE = 0x4e4f534a;
const BIN_CHUNK_TYPE = 0x004e4942;
const TRIANGLES_MODE = 4;

const COMPONENT_TYPE_SIZES: Record<number, number> = {
  5120: 1,
  5121: 1,
  5122: 2,
  5123: 2,
  5125: 4,
  5126: 4,
};

const TYPE_COMPONENT_COUNTS: Record<GltfAccessor["type"], number> = {
  SCALAR: 1,
  VEC2: 2,
  VEC3: 3,
  VEC4: 4,
};

const requireValue = <T>(value: T | undefined, message: string): T => {
  if (value === undefined) {
    throw new Error(message);
  }
  return value;
};

const readGlb = async (url: string): Promise<ParsedGlb> => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load GLB asset: ${url} (${response.status} ${response.statusText})`);
  }

  const fileBuffer = await response.arrayBuffer();
  const dataView = new DataView(fileBuffer);

  if (dataView.byteLength < 20) {
    throw new Error(`GLB asset is too small: ${url}`);
  }

  const magic = dataView.getUint32(0, true);
  const version = dataView.getUint32(4, true);
  if (magic !== GLB_MAGIC || version !== GLB_VERSION) {
    throw new Error(`Unsupported GLB header in asset: ${url}`);
  }

  const length = dataView.getUint32(8, true);
  if (length > fileBuffer.byteLength) {
    throw new Error(`GLB length header is invalid for asset: ${url}`);
  }

  let offset = 12;
  let jsonChunk: string | undefined;
  let binaryChunk: ArrayBuffer | undefined;
  const decoder = new TextDecoder();

  while (offset + 8 <= length) {
    const chunkLength = dataView.getUint32(offset, true);
    const chunkType = dataView.getUint32(offset + 4, true);
    const chunkStart = offset + 8;
    const chunkEnd = chunkStart + chunkLength;

    if (chunkEnd > length) {
      throw new Error(`GLB chunk exceeds file length in asset: ${url}`);
    }

    if (chunkType === JSON_CHUNK_TYPE) {
      jsonChunk = decoder.decode(new Uint8Array(fileBuffer, chunkStart, chunkLength));
    } else if (chunkType === BIN_CHUNK_TYPE) {
      binaryChunk = fileBuffer.slice(chunkStart, chunkEnd);
    }

    offset = chunkEnd;
  }

  if (!jsonChunk || !binaryChunk) {
    throw new Error(`GLB asset is missing JSON or BIN data: ${url}`);
  }

  return {
    json: JSON.parse(jsonChunk.trim()) as Gltf,
    binaryChunk,
  };
};

const matrixFromArray = (values: number[]) => {
  const matrix = new Matrix4();
  for (let i = 0; i < 16; i++) {
    matrix.m[i] = values[i] ?? 0;
  }
  return matrix;
};

const rotationFromQuaternion = (rotation: [number, number, number, number]) => {
  const [x, y, z, w] = rotation;
  const x2 = x + x;
  const y2 = y + y;
  const z2 = z + z;
  const xx = x * x2;
  const xy = x * y2;
  const xz = x * z2;
  const yy = y * y2;
  const yz = y * z2;
  const zz = z * z2;
  const wx = w * x2;
  const wy = w * y2;
  const wz = w * z2;

  const matrix = Matrix4.Identity();
  matrix.m[0] = 1 - (yy + zz);
  matrix.m[1] = xy + wz;
  matrix.m[2] = xz - wy;
  matrix.m[4] = xy - wz;
  matrix.m[5] = 1 - (xx + zz);
  matrix.m[6] = yz + wx;
  matrix.m[8] = xz + wy;
  matrix.m[9] = yz - wx;
  matrix.m[10] = 1 - (xx + yy);
  return matrix;
};

const getNodeMatrix = (node: GltfNode) => {
  if (node.matrix?.length === 16) {
    return matrixFromArray(node.matrix);
  }

  const translation = node.translation ?? [0, 0, 0];
  const rotation = node.rotation ?? [0, 0, 0, 1];
  const scale = node.scale ?? [1, 1, 1];

  return Matrix4.Translate(new Vector3(translation[0], translation[1], translation[2]))
    .multiply(rotationFromQuaternion(rotation))
    .multiply(Matrix4.Scale(new Vector3(scale[0], scale[1], scale[2])));
};

const normaliseDirection = (direction: Vector3) => {
  return direction.lengthSq() > 0.00000001 ? direction.normalize() : new Vector3(0, 0, 1);
};

const toRendererSpacePosition = (position: Vector3) => {
  return new Vector3(position.x, position.y, -position.z);
};

const toRendererSpaceDirection = (direction: Vector3) => {
  return new Vector3(direction.x, direction.y, -direction.z);
};

const readComponent = (
  dataView: DataView,
  byteOffset: number,
  componentType: number,
  normalized: boolean,
) => {
  switch (componentType) {
    case 5120: {
      const value = dataView.getInt8(byteOffset);
      return normalized ? Math.max(value / 127, -1) : value;
    }
    case 5121: {
      const value = dataView.getUint8(byteOffset);
      return normalized ? value / 255 : value;
    }
    case 5122: {
      const value = dataView.getInt16(byteOffset, true);
      return normalized ? Math.max(value / 32767, -1) : value;
    }
    case 5123: {
      const value = dataView.getUint16(byteOffset, true);
      return normalized ? value / 65535 : value;
    }
    case 5125: {
      const value = dataView.getUint32(byteOffset, true);
      return normalized ? value / 4294967295 : value;
    }
    case 5126:
      return dataView.getFloat32(byteOffset, true);
    default:
      throw new Error(`Unsupported accessor component type: ${componentType}`);
  }
};

const readAccessor = (gltf: Gltf, binaryChunk: ArrayBuffer, accessorIndex: number) => {
  const accessor = requireValue(
    gltf.accessors?.[accessorIndex],
    `Missing accessor ${accessorIndex}`,
  );

  if (accessor.sparse) {
    throw new Error("Sparse accessors are not supported for GLB assets");
  }

  const componentCount = TYPE_COMPONENT_COUNTS[accessor.type];
  const componentSize = COMPONENT_TYPE_SIZES[accessor.componentType];
  if (!componentSize) {
    throw new Error(`Unsupported accessor component type: ${accessor.componentType}`);
  }

  if (accessor.bufferView === undefined) {
    return new Array<number>(accessor.count * componentCount).fill(0);
  }

  const bufferView = requireValue(
    gltf.bufferViews?.[accessor.bufferView],
    `Missing buffer view ${accessor.bufferView}`,
  );
  if ((bufferView.buffer ?? 0) !== 0) {
    throw new Error("Only single-buffer GLB assets are supported");
  }

  const accessorOffset = accessor.byteOffset ?? 0;
  const bufferViewOffset = bufferView.byteOffset ?? 0;
  const byteStride = bufferView.byteStride ?? componentCount * componentSize;
  const dataView = new DataView(binaryChunk);
  const values = new Array<number>(accessor.count * componentCount);

  for (let elementIndex = 0; elementIndex < accessor.count; elementIndex++) {
    const elementOffset = bufferViewOffset + accessorOffset + elementIndex * byteStride;

    for (let componentIndex = 0; componentIndex < componentCount; componentIndex++) {
      const valueOffset = elementOffset + componentIndex * componentSize;
      values[elementIndex * componentCount + componentIndex] = readComponent(
        dataView,
        valueOffset,
        accessor.componentType,
        accessor.normalized ?? false,
      );
    }
  }

  return values;
};

const collectPrimitiveInstances = (gltf: Gltf) => {
  const primitiveInstances: PrimitiveInstance[] = [];
  const rootNodeIndices = (() => {
    if (!gltf.nodes) {
      return [];
    }

    const childNodeIndices = new Set<number>();
    for (const node of gltf.nodes) {
      for (const childIndex of node.children ?? []) {
        childNodeIndices.add(childIndex);
      }
    }

    return gltf.nodes.map((_, index) => index).filter((index) => !childNodeIndices.has(index));
  })();
  const scene =
    gltf.scenes?.[gltf.scene ?? 0] ??
    (rootNodeIndices.length ? { nodes: rootNodeIndices } : undefined);

  const visitNode = (nodeIndex: number, parentMatrix: Matrix4) => {
    const node = requireValue(gltf.nodes?.[nodeIndex], `Missing node ${nodeIndex}`);
    const worldMatrix = parentMatrix.multiply(getNodeMatrix(node));

    if (node.mesh !== undefined) {
      const mesh = requireValue(gltf.meshes?.[node.mesh], `Missing mesh ${node.mesh}`);
      for (const primitive of mesh.primitives) {
        if ((primitive.mode ?? TRIANGLES_MODE) !== TRIANGLES_MODE) {
          continue;
        }

        primitiveInstances.push({ primitive, worldMatrix });
      }
    }

    for (const childIndex of node.children ?? []) {
      visitNode(childIndex, worldMatrix);
    }
  };

  for (const nodeIndex of scene?.nodes ?? []) {
    visitNode(nodeIndex, Matrix4.Identity());
  }

  return primitiveInstances;
};

const assertSupportedTexCoord = (
  textureInfo: GltfTextureInfo | undefined,
  textureLabel: string,
) => {
  if (textureInfo && (textureInfo.texCoord ?? 0) !== 0) {
    throw new Error(`Unsupported GLB asset: ${textureLabel} must use TEXCOORD_0`);
  }
};

const convertGlbGeometry = (
  gltf: Gltf,
  binaryChunk: ArrayBuffer,
  normalize = false,
  scale = 1,
): ConvertedGlb => {
  const primitiveInstances = collectPrimitiveInstances(gltf);
  if (primitiveInstances.length > 1) {
    throw new Error("Unsupported GLB asset: only a single primitive/material is supported");
  }

  const vertices: Vector3[] = [];
  const meshNormals: Vector3[] = [];
  const meshUvs: Vector2[] = [];
  let baseColorTextureIndex: number | undefined;
  let normalTextureIndex: number | undefined;
  let baseColorFactor: Vector3 | undefined;
  let metallicFactor: number | undefined;
  let metallicRoughnessTextureIndex: number | undefined;
  let roughnessFactor: number | undefined;

  for (const { primitive, worldMatrix } of primitiveInstances) {
    const positionAccessorIndex = primitive.attributes.POSITION;
    if (positionAccessorIndex === undefined) {
      continue;
    }

    const material =
      primitive.material !== undefined ? gltf.materials?.[primitive.material] : undefined;
    const pbrMaterial = material?.pbrMetallicRoughness;
    const baseColorTexture = pbrMaterial?.baseColorTexture;
    const metallicRoughnessTexture = pbrMaterial?.metallicRoughnessTexture;
    const normalTexture = material?.normalTexture;
    assertSupportedTexCoord(baseColorTexture, "base color texture");
    assertSupportedTexCoord(normalTexture, "normal texture");
    assertSupportedTexCoord(metallicRoughnessTexture, "metallic-roughness texture");

    const hasTexturedMaterial = !!baseColorTexture || !!normalTexture || !!metallicRoughnessTexture;
    if (hasTexturedMaterial && primitive.attributes.TEXCOORD_0 === undefined) {
      throw new Error("Unsupported GLB asset: textured materials must provide TEXCOORD_0");
    }

    const uvAccessorIndex = primitive.attributes.TEXCOORD_0;

    const positions = readAccessor(gltf, binaryChunk, positionAccessorIndex);
    const sourceNormals =
      primitive.attributes.NORMAL !== undefined
        ? readAccessor(gltf, binaryChunk, primitive.attributes.NORMAL)
        : undefined;
    const sourceUvs =
      uvAccessorIndex !== undefined ? readAccessor(gltf, binaryChunk, uvAccessorIndex) : undefined;

    const positionCount = positions.length / 3;
    const indices =
      primitive.indices !== undefined
        ? readAccessor(gltf, binaryChunk, primitive.indices)
        : Array.from({ length: positionCount }, (_, index) => index);

    if (indices.length % 3 !== 0) {
      throw new Error("GLB primitive indices are not divisible by 3");
    }

    baseColorTextureIndex ??= baseColorTexture?.index;
    normalTextureIndex ??= normalTexture?.index;
    metallicRoughnessTextureIndex ??= metallicRoughnessTexture?.index;
    baseColorFactor ??=
      pbrMaterial?.baseColorFactor && pbrMaterial.baseColorFactor.length >= 3
        ? new Vector3(
            pbrMaterial.baseColorFactor[0],
            pbrMaterial.baseColorFactor[1],
            pbrMaterial.baseColorFactor[2],
          )
        : Vector3.One;
    metallicFactor ??= pbrMaterial?.metallicFactor ?? 1;
    roughnessFactor ??= pbrMaterial?.roughnessFactor ?? 1;

    const normalMatrix = worldMatrix.invert().transpose();

    for (let triangleIndex = 0; triangleIndex < indices.length; triangleIndex += 3) {
      const triangleVertexIndices = [
        indices[triangleIndex],
        indices[triangleIndex + 2],
        indices[triangleIndex + 1],
      ];

      for (const vertexIndex of triangleVertexIndices) {
        const positionOffset = vertexIndex * 3;
        const localPosition = new Vector3(
          positions[positionOffset],
          positions[positionOffset + 1],
          positions[positionOffset + 2],
        );
        const worldPosition = worldMatrix.transformPoint(localPosition);
        vertices.push(toRendererSpacePosition(worldPosition));

        if (sourceUvs) {
          const uvOffset = vertexIndex * 2;
          // glTF UV space uses an upper-left origin, while the renderer
          // expects a lower-left V convention.
          meshUvs.push(new Vector2(sourceUvs[uvOffset], 1 - sourceUvs[uvOffset + 1]));
        }

        if (sourceNormals) {
          const normalOffset = vertexIndex * 3;
          const worldNormal = normaliseDirection(
            normalMatrix.transformDirection(
              new Vector3(
                sourceNormals[normalOffset],
                sourceNormals[normalOffset + 1],
                sourceNormals[normalOffset + 2],
              ),
            ),
          );
          meshNormals.push(toRendererSpaceDirection(worldNormal));
        }
      }
    }
  }

  if (vertices.length === 0) {
    throw new Error("No triangle primitives were found in the GLB asset");
  }

  return {
    mesh: buildLoadedModel(
      {
        vertices,
        normals: meshNormals.length ? meshNormals : undefined,
        uvs: meshUvs.length ? meshUvs : undefined,
      },
      normalize,
      scale,
    ),
    baseColorTextureIndex,
    normalTextureIndex,
    pbrMaterial: {
      baseColorFactor: baseColorFactor ?? Vector3.One,
      metallicFactor: metallicFactor ?? 1,
      metallicRoughnessTextureIndex,
      roughnessFactor: roughnessFactor ?? 1,
    },
  };
};

const loadTextureFromImage = async (
  gltf: Gltf,
  binaryChunk: ArrayBuffer,
  imageIndex: number,
  assetUrl: string,
  descriptor: TextureDescriptor,
) => {
  const image = requireValue(gltf.images?.[imageIndex], `Missing image ${imageIndex}`);

  if (image.bufferView !== undefined) {
    const bufferView = requireValue(
      gltf.bufferViews?.[image.bufferView],
      `Missing buffer view ${image.bufferView}`,
    );
    const byteOffset = bufferView.byteOffset ?? 0;
    const mimeType = image.mimeType ?? "image/png";
    const bytes = new Uint8Array(binaryChunk, byteOffset, bufferView.byteLength);
    const objectUrl = URL.createObjectURL(new Blob([bytes], { type: mimeType }));
    try {
      return await Texture.Load(objectUrl, descriptor);
    } finally {
      URL.revokeObjectURL(objectUrl);
    }
  }

  if (image.uri) {
    const baseUrl = new URL(assetUrl, window.location.href);
    return Texture.Load(new URL(image.uri, baseUrl).toString(), descriptor);
  }

  throw new Error(`Image ${imageIndex} does not contain data`);
};

const loadTextureFromSlot = async (
  gltf: Gltf,
  binaryChunk: ArrayBuffer,
  textureIndex: number | undefined,
  assetUrl: string,
  fallback: Texture,
  descriptor: TextureDescriptor,
) => {
  if (textureIndex === undefined) {
    return fallback;
  }

  const texture = requireValue(gltf.textures?.[textureIndex], `Missing texture ${textureIndex}`);
  if (texture.source === undefined) {
    return fallback;
  }

  return loadTextureFromImage(gltf, binaryChunk, texture.source, assetUrl, descriptor);
};

export const loadGlbAsset = async (url: string, normalize = true, scale = 1) => {
  const { json, binaryChunk } = await readGlb(url);
  const converted = convertGlbGeometry(json, binaryChunk, normalize, scale);

  const [texture, normalTexture, metallicRoughnessTexture] = await Promise.all([
    loadTextureFromSlot(
      json,
      binaryChunk,
      converted.baseColorTextureIndex,
      url,
      new Texture(new Float32Array([1, 1, 1]), 1, 1),
      { type: "color", colorSpace: "srgb" },
    ),
    loadTextureFromSlot(
      json,
      binaryChunk,
      converted.normalTextureIndex,
      url,
      new Texture(new Float32Array([0, 0, 1]), 1, 1),
      { type: "normal", colorSpace: "linear" },
    ),
    loadTextureFromSlot(
      json,
      binaryChunk,
      converted.pbrMaterial.metallicRoughnessTextureIndex,
      url,
      new Texture(new Float32Array([1, 1, 1]), 1, 1),
      { type: "color", colorSpace: "linear" },
    ),
  ]);

  return {
    mesh: converted.mesh,
    texture,
    normalTexture,
    pbrMaterial: {
      baseColorFactor: converted.pbrMaterial.baseColorFactor,
      metallicFactor: converted.pbrMaterial.metallicFactor,
      metallicRoughnessTexture,
      roughnessFactor: converted.pbrMaterial.roughnessFactor,
    },
  };
};
