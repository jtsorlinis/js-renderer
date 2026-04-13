import { Matrix4, Vector3, Vector4 } from "../maths";
import { DepthTexture, Framebuffer, edgeFunction, line, triangle } from "../drawing";
import type { BufferRegion } from "../drawing/BufferRegion";
import { BaseShader } from "../shaders/BaseShader";
import { DepthShader } from "../shaders/Depth";
import { FlatShader } from "../shaders/Flat";
import { IblShader } from "../shaders/Ibl";
import { NormalMappedShader } from "../shaders/NormalMapped";
import { PbrShader } from "../shaders/Pbr";
import { SmoothShader } from "../shaders/Smooth";
import { TexturedShader } from "../shaders/Textured";
import { UnlitShader } from "../shaders/Unlit";
import type { Material } from "../materials/Material";
import type { IblData } from "../shaders/iblHelpers";
import type { MaterialMode, RenderMode } from "../renderSettings";
import type { Mesh } from "../utils/mesh";

export interface RenderSettings {
  material: MaterialMode;
  renderMode?: RenderMode;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
}

export interface StaticRenderScene {
  model: Mesh;
  material: Material;
  iblData: IblData;
  lightDir: Vector3;
  lightCol: Vector3;
  envYaw: { sin: number; cos: number };
  shadowOrthoSize: number;
}

export interface FrameRenderState {
  modelPos: Vector3;
  modelRotation: Vector3;
  modelScale: Vector3;
  camPos: Vector3;
  viewDir: Vector3;
  aspectRatio: number;
  orthoSize: number;
  isOrtho: boolean;
  renderSettings: RenderSettings;
}

export interface RenderTargets {
  frameBuffer: Framebuffer;
  depthBuffer: DepthTexture;
  shadowMap: DepthTexture;
  shadowBuffer: Framebuffer;
  backgroundBuffer?: Framebuffer;
}

export interface DrawSceneOptions {
  triangleVertexIndices?: Uint32Array;
  skipShadowPass?: boolean;
}

export type ShaderMap = {
  ibl: IblShader;
  pbr: PbrShader;
  normalMapped: NormalMappedShader;
  textured: TexturedShader;
  smooth: SmoothShader;
  flat: FlatShader;
  unlit: UnlitShader;
  depth: DepthShader;
};

const cameraLookDir = Vector3.Forward;

export const createShaders = (): ShaderMap => {
  return {
    ibl: new IblShader(),
    pbr: new PbrShader(),
    normalMapped: new NormalMappedShader(),
    textured: new TexturedShader(),
    smooth: new SmoothShader(),
    flat: new FlatShader(),
    unlit: new UnlitShader(),
    depth: new DepthShader(),
  };
};

export const renderShadowPass = (
  scene: StaticRenderScene,
  frame: FrameRenderState,
  shadowMap: DepthTexture,
  shadowBuffer: Framebuffer,
  shaders: ShaderMap,
  fov: number,
) => {
  const { model } = scene;
  const { lightSpaceMat } = buildFrameTransforms(scene, frame, fov);
  shadowMap.clear(1000);
  shaders.depth.uniforms = { model, clipMat: lightSpaceMat };
  renderMesh(model, shaders.depth, shadowMap, "filled", shadowBuffer);
};

const buildFrameTransforms = (scene: StaticRenderScene, frame: FrameRenderState, fov: number) => {
  const { lightDir, shadowOrthoSize } = scene;
  const { modelPos, modelRotation, modelScale, camPos, viewDir, aspectRatio, orthoSize } = frame;
  const modelMat = Matrix4.TRS(modelPos, modelRotation, modelScale);
  const invModelMat = modelMat.invert();
  const normalMat = invModelMat.transpose();

  const lightViewMat = Matrix4.LookAt(lightDir.scale(-5), Vector3.Zero);
  const lightProjMat = Matrix4.Ortho(shadowOrthoSize, 1, 1, 10);
  const lightSpaceMat = lightProjMat.multiply(lightViewMat).multiply(modelMat);
  const modelLightDir = invModelMat.transformDirection(lightDir).normalize();
  const modelCamPos = invModelMat.transformPoint(camPos);
  const modelViewDir = invModelMat.transformDirection(viewDir).normalize();

  const viewMat = Matrix4.LookTo(camPos, cameraLookDir, Vector3.Up);
  const projMat = frame.isOrtho
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(fov, aspectRatio);
  const mvp = projMat.multiply(viewMat).multiply(modelMat);

  return {
    modelMat,
    normalMat,
    lightSpaceMat,
    modelLightDir,
    modelCamPos,
    modelViewDir,
    mvp,
  };
};

const renderMesh = (
  model: Mesh,
  activeShader: BaseShader,
  depthBuffer: DepthTexture,
  renderMode: RenderMode = "filled",
  targetBuffer: Framebuffer,
  triangleVertexIndices?: Uint32Array,
) => {
  const triVerts: Vector4[] = [];
  const triangleCount = triangleVertexIndices ? triangleVertexIndices.length : model.vertices.length / 3;

  for (let triangleIndex = 0; triangleIndex < triangleCount; triangleIndex += 1) {
    const i = triangleVertexIndices ? triangleVertexIndices[triangleIndex] : triangleIndex * 3;

    for (let j = 0; j < 3; j += 1) {
      activeShader.vertexId = i + j;
      activeShader.nthVert = j;
      triVerts[j] = activeShader.vertex().perspectiveDivide();
    }

    if (renderMode !== "filled") {
      const isDepthWireframe = renderMode === "depthWireframe";
      const area = edgeFunction(triVerts[0], triVerts[1], triVerts[2]);
      if (isDepthWireframe && area <= 0) continue;

      line(triVerts[0], triVerts[1], targetBuffer, depthBuffer);
      line(triVerts[1], triVerts[2], targetBuffer, depthBuffer);
      line(triVerts[2], triVerts[0], targetBuffer, depthBuffer);
      continue;
    }

    triangle(triVerts, activeShader, targetBuffer, depthBuffer);
  }
};

export const buildTileTriangleBins = (
  scene: StaticRenderScene,
  frame: FrameRenderState,
  fov: number,
  viewportWidth: number,
  viewportHeight: number,
  tiles: BufferRegion[],
) => {
  const bins = tiles.map(() => [] as number[]);
  if (tiles.length === 0) {
    return bins.map((bin) => Uint32Array.from(bin));
  }

  const { model } = scene;
  const { mvp } = buildFrameTransforms(scene, frame, fov);
  const halfWidth = viewportWidth * 0.5;
  const halfHeight = viewportHeight * 0.5;
  const shouldCullBackfaces = frame.renderSettings.renderMode !== "wireframe";

  for (let i = 0; i < model.vertices.length; i += 3) {
    const v0 = mvp.transformPoint4(model.vertices[i]).perspectiveDivide();
    const v1 = mvp.transformPoint4(model.vertices[i + 1]).perspectiveDivide();
    const v2 = mvp.transformPoint4(model.vertices[i + 2]).perspectiveDivide();

    if (
      !Number.isFinite(v0.x) ||
      !Number.isFinite(v0.y) ||
      !Number.isFinite(v0.z) ||
      !Number.isFinite(v1.x) ||
      !Number.isFinite(v1.y) ||
      !Number.isFinite(v1.z) ||
      !Number.isFinite(v2.x) ||
      !Number.isFinite(v2.y) ||
      !Number.isFinite(v2.z)
    ) {
      continue;
    }

    if (v0.z < 0 || v1.z < 0 || v2.z < 0) continue;
    if (v0.z > 1 || v1.z > 1 || v2.z > 1) continue;

    const p0x = (v0.x + 1) * halfWidth;
    const p0y = (-v0.y + 1) * halfHeight;
    const p1x = (v1.x + 1) * halfWidth;
    const p1y = (-v1.y + 1) * halfHeight;
    const p2x = (v2.x + 1) * halfWidth;
    const p2y = (-v2.y + 1) * halfHeight;

    if (
      (p0x < 0 && p1x < 0 && p2x < 0) ||
      (p0x > viewportWidth && p1x > viewportWidth && p2x > viewportWidth) ||
      (p0y < 0 && p1y < 0 && p2y < 0) ||
      (p0y > viewportHeight && p1y > viewportHeight && p2y > viewportHeight)
    ) {
      continue;
    }

    if (shouldCullBackfaces) {
      const area = (p2x - p0x) * (p1y - p0y) - (p2y - p0y) * (p1x - p0x);
      if (area <= 0) continue;
    }

    const minX = Math.max(0, Math.min(p0x, p1x, p2x));
    const minY = Math.max(0, Math.min(p0y, p1y, p2y));
    const maxX = Math.min(viewportWidth - 1, Math.max(p0x, p1x, p2x));
    const maxY = Math.min(viewportHeight - 1, Math.max(p0y, p1y, p2y));

    if (minX > maxX || minY > maxY) {
      continue;
    }

    for (let tileIndex = 0; tileIndex < tiles.length; tileIndex += 1) {
      const tile = tiles[tileIndex];
      const tileMaxX = tile.x + tile.width - 1;
      const tileMaxY = tile.y + tile.height - 1;
      if (maxX < tile.x || minX > tileMaxX || maxY < tile.y || minY > tileMaxY) {
        continue;
      }
      bins[tileIndex].push(i);
    }
  }

  return bins.map((bin) => Uint32Array.from(bin));
};

export const drawScene = (
  scene: StaticRenderScene,
  frame: FrameRenderState,
  targets: RenderTargets,
  shaders: ShaderMap,
  fov: number,
  options: DrawSceneOptions = {},
) => {
  const { frameBuffer, depthBuffer, shadowMap, shadowBuffer, backgroundBuffer } = targets;
  const { model, material, iblData, lightDir, lightCol, envYaw } = scene;
  const renderSettings = frame.renderSettings;
  const { triangleVertexIndices, skipShadowPass } = options;

  if (renderSettings.showEnvironmentBackground && backgroundBuffer) {
    frameBuffer.copyFrom(backgroundBuffer);
  } else {
    frameBuffer.clear();
  }
  depthBuffer.clear(1000);

  if (triangleVertexIndices && triangleVertexIndices.length === 0) {
    return;
  }

  const { modelMat, normalMat, lightSpaceMat, modelLightDir, modelCamPos, modelViewDir, mvp } =
    buildFrameTransforms(scene, frame, fov);

  const shader = shaders[renderSettings.material];
  shader.uniforms = {
    model,
    modelMat,
    mvp,
    normalMat,
    worldLightDir: lightDir,
    envYaw,
    modelLightDir,
    lightCol,
    worldCamPos: frame.camPos,
    modelCamPos,
    orthographic: frame.isOrtho,
    worldViewDir: frame.viewDir,
    modelViewDir,
    material,
    iblData,
    lightSpaceMat,
    shadowMap,
    receiveShadows: renderSettings.useShadows,
  };
  shaders.depth.uniforms = { model, clipMat: mvp };

  if (renderSettings.useShadows && !skipShadowPass) {
    renderShadowPass(scene, frame, shadowMap, shadowBuffer, shaders, fov);
  }

  if (renderSettings.renderMode === "depthWireframe") {
    renderMesh(model, shaders.depth, depthBuffer, "filled", frameBuffer, triangleVertexIndices);
  }

  renderMesh(
    model,
    shader,
    depthBuffer,
    renderSettings.renderMode,
    frameBuffer,
    triangleVertexIndices,
  );
};
