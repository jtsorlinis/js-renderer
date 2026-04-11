import { Texture } from "../drawing";
import { Matrix4, Vector2, Vector3, Vector4 } from "../maths";

const CAMERA_FOV = 50;
const INV_TAU = 1 / (Math.PI * 2);

export const createCameraRay = (
  ndcX: number,
  ndcY: number,
  position: Vector3,
  aspectRatio: number,
  cameraOrthoSize: number,
  orthographic: boolean,
) => {
  if (orthographic) {
    return {
      origin: new Vector3(
        position.x + ndcX * aspectRatio * cameraOrthoSize,
        position.y + ndcY * cameraOrthoSize,
        position.z,
      ),
      direction: new Vector3(0, 0, 1),
    };
  }

  const tanHalfFov = Math.tan((CAMERA_FOV * Math.PI) / 360);
  return {
    origin: position.clone(),
    direction: new Vector3(ndcX * aspectRatio * tanHalfFov, ndcY * tanHalfFov, 1).normalize(),
  };
};

export const sampleTexture = (texture: Texture, uv: Vector2) => {
  const x = Math.max(0, Math.min(texture.width - 1, ~~(uv.x * texture.width)));
  const y = Math.max(0, Math.min(texture.height - 1, ~~((1 - uv.y) * texture.height)));
  const base = (x + y * texture.width) * 3;
  return new Vector3(texture.data[base], texture.data[base + 1], texture.data[base + 2]);
};

export const sampleEnvironment = (
  texture: Texture,
  envYaw: { angle: number; sin: number; cos: number },
  direction: Vector3,
) => {
  const { u, v } = environmentDirectionToUv(direction, envYaw);
  return sampleLatLongTexture(texture, u, v);
};

export const environmentDirectionToUv = (
  direction: Vector3,
  envYaw: { angle: number; sin: number; cos: number },
) => {
  const rotatedX = direction.x * envYaw.cos - direction.z * envYaw.sin;
  const rotatedZ = direction.x * envYaw.sin + direction.z * envYaw.cos;
  return {
    u: wrapUnit(Math.atan2(rotatedX, rotatedZ) * INV_TAU + 0.5),
    v: Math.acos(Math.max(-1, Math.min(1, direction.y))) / Math.PI,
  };
};

export const environmentUvToDirection = (
  u: number,
  v: number,
  envYaw: { angle: number; sin: number; cos: number },
) => {
  const phi = (wrapUnit(u) - 0.5) * Math.PI * 2;
  const theta = Math.max(0, Math.min(1, v)) * Math.PI;
  const sinTheta = Math.sin(theta);
  const rotatedX = Math.sin(phi) * sinTheta;
  const rotatedZ = Math.cos(phi) * sinTheta;

  return new Vector3(
    rotatedX * envYaw.cos + rotatedZ * envYaw.sin,
    Math.cos(theta),
    rotatedZ * envYaw.cos - rotatedX * envYaw.sin,
  ).normalize();
};

export const applyNormalMap = (
  worldNormal: Vector3,
  tangent0: Vector4,
  tangent1: Vector4,
  tangent2: Vector4,
  baryW: number,
  baryU: number,
  baryV: number,
  modelMat: Matrix4,
  normalTexture: Texture,
  uv: Vector2,
) => {
  const tangent = modelMat
    .transformDirection(
      new Vector3(
        tangent0.x * baryW + tangent1.x * baryU + tangent2.x * baryV,
        tangent0.y * baryW + tangent1.y * baryU + tangent2.y * baryV,
        tangent0.z * baryW + tangent1.z * baryU + tangent2.z * baryV,
      ),
    )
    .normalize();
  const handedness = tangent0.w * baryW + tangent1.w * baryU + tangent2.w * baryV < 0 ? -1 : 1;
  const tangentOrtho = tangent.subtract(worldNormal.scale(worldNormal.dot(tangent))).normalize();
  const bitangent = worldNormal.cross(tangentOrtho).scale(handedness);
  const normalTexel = sampleTexture(normalTexture, uv);
  return tangentOrtho
    .scale(normalTexel.x)
    .add(bitangent.scale(normalTexel.y))
    .add(worldNormal.scale(normalTexel.z))
    .normalize();
};

export const buildBasis = (normal: Vector3) => {
  const tangent =
    Math.abs(normal.y) < 0.999 ? new Vector3(normal.z, 0, -normal.x) : new Vector3(1, 0, 0);
  const tangentOrtho = tangent.normalize();
  return {
    tangent: tangentOrtho,
    bitangent: normal.cross(tangentOrtho).normalize(),
  };
};

const sampleLatLongTexture = (texture: Texture, u: number, v: number) => {
  const xCoord = wrapUnit(u) * texture.width - 0.5;
  const yCoord = Math.max(0, Math.min(texture.height - 1, v * texture.height - 0.5));
  const x0 = Math.floor(xCoord);
  const y0 = Math.floor(yCoord);
  const xBlend = xCoord - x0;
  const yBlend = yCoord - y0;
  const xIndex0 = ((x0 % texture.width) + texture.width) % texture.width;
  const xIndex1 = (xIndex0 + 1) % texture.width;
  const yIndex0 = Math.max(0, Math.min(texture.height - 1, y0));
  const yIndex1 = Math.min(yIndex0 + 1, texture.height - 1);
  const rowStride = texture.width * 3;
  const base00 = yIndex0 * rowStride + xIndex0 * 3;
  const base10 = yIndex0 * rowStride + xIndex1 * 3;
  const base01 = yIndex1 * rowStride + xIndex0 * 3;
  const base11 = yIndex1 * rowStride + xIndex1 * 3;

  return new Vector3(
    bilinearChannel(
      texture.data[base00],
      texture.data[base10],
      texture.data[base01],
      texture.data[base11],
      xBlend,
      yBlend,
    ),
    bilinearChannel(
      texture.data[base00 + 1],
      texture.data[base10 + 1],
      texture.data[base01 + 1],
      texture.data[base11 + 1],
      xBlend,
      yBlend,
    ),
    bilinearChannel(
      texture.data[base00 + 2],
      texture.data[base10 + 2],
      texture.data[base01 + 2],
      texture.data[base11 + 2],
      xBlend,
      yBlend,
    ),
  );
};

const bilinearChannel = (
  topLeft: number,
  topRight: number,
  bottomLeft: number,
  bottomRight: number,
  xBlend: number,
  yBlend: number,
) => {
  const top = topLeft + (topRight - topLeft) * xBlend;
  const bottom = bottomLeft + (bottomRight - bottomLeft) * xBlend;
  return top + (bottom - top) * yBlend;
};

const wrapUnit = (value: number) => {
  return value - Math.floor(value);
};
