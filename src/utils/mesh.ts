import { Vector2, Vector3, Vector4 } from "../maths";

const EPSILON = 0.00000001;

export type Mesh = {
  // One entry per vertex
  vertices: Vector3[];
  normals: Vector3[];
  uvs: Vector2[];
  tangents: Vector4[];
  // Three vertex indices per triangle, so triangles can share vertices
  indices: Uint32Array;
  // One entry per triangle
  faceNormals: Vector3[];
};

type MeshSource = {
  vertices: Vector3[];
  indices: Uint32Array;
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

const getFaceNormals = (vertices: Vector3[], indices: Uint32Array) => {
  const faceNormals: Vector3[] = [];

  for (let i = 0; i < indices.length; i += 3) {
    const v0 = vertices[indices[i]];
    const v1 = vertices[indices[i + 1]];
    const v2 = vertices[indices[i + 2]];
    faceNormals.push(v2.subtract(v0).cross(v1.subtract(v0)).normalize());
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

// A vertex's tangent is the sum of the tangents of the triangles around it, made perpendicular to
// its normal
const getTangents = (
  vertices: Vector3[],
  normals: Vector3[],
  uvs: Vector2[],
  indices: Uint32Array,
) => {
  const tangentSums = vertices.map(() => new Vector3());
  const bitangentSums = vertices.map(() => new Vector3());

  for (let i = 0; i < indices.length; i += 3) {
    const i0 = indices[i];
    const i1 = indices[i + 1];
    const i2 = indices[i + 2];
    const edge1 = vertices[i1].subtract(vertices[i0]);
    const edge2 = vertices[i2].subtract(vertices[i0]);
    const deltaUV1 = uvs[i1].subtract(uvs[i0]);
    const deltaUV2 = uvs[i2].subtract(uvs[i0]);
    const det = deltaUV1.x * deltaUV2.y - deltaUV2.x * deltaUV1.y;
    if (Math.abs(det) <= 0.000001) continue;

    const invDet = 1 / det;
    const tangent = edge1.scale(deltaUV2.y).subtract(edge2.scale(deltaUV1.y)).scale(invDet);
    const bitangent = edge2.scale(deltaUV1.x).subtract(edge1.scale(deltaUV2.x)).scale(invDet);
    for (const index of [i0, i1, i2]) {
      tangentSums[index] = tangentSums[index].add(tangent);
      bitangentSums[index] = bitangentSums[index].add(bitangent);
    }
  }

  return vertices.map((_, i) => {
    const normal = normals[i];
    let tangent = tangentSums[i].subtract(normal.scale(normal.dot(tangentSums[i])));
    tangent = tangent.lengthSq() < EPSILON ? getFallbackTangent(normal) : tangent.normalize();
    const handedness = normal.cross(tangent).dot(bitangentSums[i]) < 0 ? -1 : 1;
    return tangent.extend(handedness);
  });
};

// Gives every triangle three vertices of its own
const unshareVertices = (source: MeshSource): MeshSource => {
  const { vertices, uvs, indices } = source;
  return {
    vertices: Array.from(indices, (index) => vertices[index]),
    uvs: uvs && Array.from(indices, (index) => uvs[index]),
    indices: Uint32Array.from(indices, (_, corner) => corner),
  };
};

export const getModelRadius = (mesh: Mesh) => {
  return mesh.vertices.reduce((max, vertex) => Math.max(max, vertex.length()), 0);
};

export const buildLoadedModel = (source: MeshSource, scale: number): Mesh => {
  // A mesh without normals is shaded flat, and a vertex shared between triangles could only hold
  // one of their face normals
  const mesh = source.normals ? source : unshareVertices(source);
  const { indices } = mesh;
  const vertices = normalizeVertices(mesh.vertices, scale);
  const faceNormals = getFaceNormals(vertices, indices);
  const normals =
    mesh.normals?.map((normal) => normal.normalized()) ??
    vertices.map((_, vertex) => faceNormals[Math.floor(vertex / 3)]);
  const uvs = mesh.uvs ?? vertices.map(() => new Vector2(0, 0));

  return {
    vertices,
    normals,
    uvs,
    tangents: getTangents(vertices, normals, uvs, indices),
    indices,
    faceNormals,
  };
};
