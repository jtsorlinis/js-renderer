import { Vector2, Vector3, Vector4 } from "../maths";

const EPSILON = 0.00000001;

export type Mesh = {
  vertices: Vector3[];
  normals: Vector3[];
  faceNormals: Vector3[];
  uvs: Vector2[];
  tangents: Vector4[];
};

type MeshSource = {
  vertices: Vector3[];
  normals?: Vector3[];
  uvs?: Vector2[];
};

const getFallbackTangent = (normal: Vector3) => {
  const reference = Math.abs(normal.y) < 0.999 ? Vector3.Up : Vector3.Forward;
  let tangent = reference.cross(normal);
  if (tangent.lengthSq() < EPSILON) {
    tangent = new Vector3(1, 0, 0).cross(normal);
  }
  return (tangent.lengthSq() < EPSILON ? new Vector3(1, 0, 0) : tangent).normalize();
};

const getFaceNormals = (vertices: Vector3[]) => {
  const faceNormals: Vector3[] = [];

  for (let i = 0; i < vertices.length; i += 3) {
    const normal = vertices[i + 2]
      .subtract(vertices[i])
      .cross(vertices[i + 1].subtract(vertices[i]))
      .normalize();
    faceNormals.push(normal, normal, normal);
  }

  return faceNormals;
};

// Centres the vertices on the origin and fits them inside a sphere of radius scale
const normalizeVertices = (vertices: Vector3[], scale: number) => {
  const maxPos = new Vector3(-Infinity, -Infinity, -Infinity);
  const minPos = new Vector3(Infinity, Infinity, Infinity);

  for (const vertex of vertices) {
    if (vertex.x > maxPos.x) maxPos.x = vertex.x;
    if (vertex.y > maxPos.y) maxPos.y = vertex.y;
    if (vertex.z > maxPos.z) maxPos.z = vertex.z;
    if (vertex.x < minPos.x) minPos.x = vertex.x;
    if (vertex.y < minPos.y) minPos.y = vertex.y;
    if (vertex.z < minPos.z) minPos.z = vertex.z;
  }

  const translate = maxPos.add(minPos).scale(0.5);
  let maxRadiusSq = 0;

  for (const vertex of vertices) {
    maxRadiusSq = Math.max(maxRadiusSq, vertex.subtract(translate).lengthSq());
  }

  const fitScale = maxRadiusSq <= 0 ? 1 : 1 / Math.sqrt(maxRadiusSq);
  return vertices.map((vertex) => vertex.subtract(translate).scale(fitScale).scale(scale));
};

const getTangents = (vertices: Vector3[], normals: Vector3[], uvs: Vector2[]) => {
  const tangents: Vector4[] = [];

  for (let i = 0; i < vertices.length; i += 3) {
    let faceTangent = getFallbackTangent(normals[i]);
    let faceBitangent = normals[i].cross(faceTangent).normalize();

    if (uvs.length === vertices.length) {
      const edge1 = vertices[i + 1].subtract(vertices[i]);
      const edge2 = vertices[i + 2].subtract(vertices[i]);
      const deltaUV1 = uvs[i + 1].subtract(uvs[i]);
      const deltaUV2 = uvs[i + 2].subtract(uvs[i]);
      const det = deltaUV1.x * deltaUV2.y - deltaUV2.x * deltaUV1.y;

      if (Math.abs(det) > 0.000001) {
        const invDet = 1 / det;
        faceTangent = edge1.scale(deltaUV2.y).subtract(edge2.scale(deltaUV1.y)).scale(invDet);
        faceBitangent = edge2.scale(deltaUV1.x).subtract(edge1.scale(deltaUV2.x)).scale(invDet);
      }
    }

    for (let j = 0; j < 3; j++) {
      const normal = normals[i + j];
      let tangent = faceTangent.subtract(normal.scale(normal.dot(faceTangent)));
      if (tangent.lengthSq() < EPSILON) {
        tangent = getFallbackTangent(normal);
      } else {
        tangent = tangent.normalize();
      }

      const projectedBitangent = faceBitangent.subtract(normal.scale(normal.dot(faceBitangent)));
      const handedness =
        projectedBitangent.lengthSq() > EPSILON &&
        normal.cross(tangent).normalize().dot(projectedBitangent) < 0
          ? -1
          : 1;
      tangents.push(tangent.extend(handedness));
    }
  }

  return tangents;
};

export const getModelRadius = (mesh: Mesh) => {
  return mesh.vertices.reduce((max, vertex) => Math.max(max, vertex.length()), 0);
};

export const facesAway = (mesh: Mesh, i: number, viewpoint: Vector4) => {
  const n = mesh.faceNormals[i];
  const v = mesh.vertices[i];
  const facing =
    n.x * (viewpoint.x - v.x * viewpoint.w) +
    n.y * (viewpoint.y - v.y * viewpoint.w) +
    n.z * (viewpoint.z - v.z * viewpoint.w);
  return facing < 0;
};

// source holds three entries per triangle in each attribute
export const buildLoadedModel = (source: MeshSource, scale: number): Mesh => {
  const vertices = normalizeVertices(source.vertices, scale);
  const faceNormals = getFaceNormals(vertices);
  const normals = source.normals?.map((normal) => normal.normalized()) ?? faceNormals.slice();
  const uvs = source.uvs ?? vertices.map(() => new Vector2(0, 0));

  return {
    vertices,
    normals,
    faceNormals,
    uvs,
    tangents: getTangents(vertices, normals, uvs),
  };
};
