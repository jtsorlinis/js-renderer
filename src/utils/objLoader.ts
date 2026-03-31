import { Vector2, Vector3 } from "../maths";

export type LoadedModel = ReturnType<typeof loadObj>;

const getFallbackTangent = (normal: Vector3) => {
  const reference = Math.abs(normal.y) < 0.999 ? Vector3.Up : Vector3.Forward;
  let tangent = reference.cross(normal);
  if (tangent.lengthSq() < 0.00000001) {
    tangent = new Vector3(1, 0, 0).cross(normal);
  }
  if (tangent.lengthSq() < 0.00000001) {
    tangent = new Vector3(1, 0, 0);
  }
  return tangent.normalize();
};

export const getModelRadius = (mesh: LoadedModel) => {
  return mesh.vertices.reduce((max, v) => Math.max(max, v.length()), 0);
};

export const loadObjAsset = async (
  url: string,
  normalize = true,
  scale = 1,
) => {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(
      `Failed to load OBJ asset: ${url} (${response.status} ${response.statusText})`,
    );
  }
  return loadObj(await response.text(), normalize, scale);
};

export const loadObj = (file: string, normalize = false, scale = 1) => {
  const vertices: Vector3[] = [];
  let normals: Vector3[] = [];
  const uvs: Vector2[] = [];
  const faceNormals: Vector3[] = [];
  const tangents: Vector3[] = [];
  const bitangents: Vector3[] = [];
  const tangentKeys: string[] = [];

  const tempVerts: Vector3[] = [];
  const tempUVs: Vector2[] = [];
  const tempNormals: Vector3[] = [];
  const tempTris: number[] = [];
  const tempUVTris: number[] = [];
  const tempNormalTris: number[] = [];

  const pushCorner = (corner: string) => {
    const [vert, uv, normal] = corner.split("/");
    tempTris.push(+vert - 1);
    tempUVTris.push(uv ? +uv - 1 : -1);
    tempNormalTris.push(normal ? +normal - 1 : -1);
  };

  // OBJ assets are authored in a right-handed convention, while the renderer
  // uses a left-handed camera/projection setup. Negating Z changes handedness;
  // reversing the corner order for each triangle preserves front-facing winding.
  const pushTriangle = (a: string, b: string, c: string) => {
    pushCorner(a);
    pushCorner(c);
    pushCorner(b);
  };

  const lines = file.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const split = lines[i].trim().split(/\s+/);
    const isQuad = split.length === 5;
    if (split[0] == "v") {
      tempVerts.push(new Vector3(+split[1], +split[2], -+split[3]));
    } else if (split[0] == "vt") {
      tempUVs.push(new Vector2(+split[1], +split[2]));
    } else if (split[0] == "vn") {
      tempNormals.push(new Vector3(+split[1], +split[2], -+split[3]));
    } else if (split[0] == "f") {
      // Check if quad
      if (isQuad) {
        pushTriangle(split[1], split[2], split[3]);
        pushTriangle(split[1], split[3], split[4]);
      } else {
        pushTriangle(split[1], split[2], split[3]);
      }
    }
  }

  const maxPos = new Vector3(0, 0, 0);
  const minPos = new Vector3(0, 0, 0);

  // rebuild vertices and normals
  for (let i = 0; i < tempTris.length; i++) {
    const vertIndex = tempTris[i];
    const uvIndex = tempUVTris[i];
    const normalIndex = tempNormalTris[i];
    const vert = tempVerts[vertIndex];
    const normal = tempNormals[normalIndex];
    const uv = tempUVs[uvIndex];
    vertices.push(vert);
    if (normal) {
      normals.push(normal);
    }
    if (uv) {
      uvs.push(uv);
    }

    tangentKeys.push(
      normal && uv ? `${vertIndex}/${uvIndex}/${normalIndex}` : `corner/${i}`,
    );

    if (vert.x > maxPos.x) maxPos.x = vert.x;
    if (vert.y > maxPos.y) maxPos.y = vert.y;
    if (vert.z > maxPos.z) maxPos.z = vert.z;
    if (vert.x < minPos.x) minPos.x = vert.x;
    if (vert.y < minPos.y) minPos.y = vert.y;
    if (vert.z < minPos.z) minPos.z = vert.z;
  }

  // Flat normals
  for (let i = 0; i < vertices.length; i += 3) {
    const ab = vertices[i + 1].subtract(vertices[i]);
    const ac = vertices[i + 2].subtract(vertices[i]);
    const normal = ab.cross(ac).normalize();
    faceNormals.push(normal, normal, normal);
  }

  // Scale and center model
  if (normalize) {
    const translate = maxPos.add(minPos).scale(0.5);
    let maxRadiusSq = 0;
    for (let i = 0; i < vertices.length; i++) {
      vertices[i] = vertices[i].subtract(translate);
      maxRadiusSq = Math.max(maxRadiusSq, vertices[i].lengthSq());
    }

    if (maxRadiusSq > 0) {
      const scaleFactor = 1 / Math.sqrt(maxRadiusSq);
      for (let i = 0; i < vertices.length; i++) {
        vertices[i] = vertices[i].scale(scaleFactor);
      }
    }
  }

  if (scale !== 1) {
    for (let i = 0; i < vertices.length; i++) {
      vertices[i] = vertices[i].scale(scale);
    }
  }

  // If no normals, use face normals
  if (!normals.length) {
    normals = faceNormals;
  }

  // Normalise once at load time so shaders can use these directly
  for (let i = 0; i < normals.length; i++) {
    normals[i] = normals[i].normalized();
  }

  // Generate tangent basis for tangent-space normal mapping
  if (uvs.length === vertices.length) {
    const tangentSums = new Map<string, Vector3>();
    const bitangentSums = new Map<string, Vector3>();

    for (let i = 0; i < vertices.length; i += 3) {
      const v0 = vertices[i];
      const v1 = vertices[i + 1];
      const v2 = vertices[i + 2];

      const uv0 = uvs[i];
      const uv1 = uvs[i + 1];
      const uv2 = uvs[i + 2];

      const edge1 = v1.subtract(v0);
      const edge2 = v2.subtract(v0);
      const deltaUV1 = uv1.subtract(uv0);
      const deltaUV2 = uv2.subtract(uv0);
      const det = deltaUV1.x * deltaUV2.y - deltaUV2.x * deltaUV1.y;

      let faceTangent: Vector3;
      let faceBitangent: Vector3;

      if (Math.abs(det) > 0.000001) {
        const invDet = 1 / det;
        faceTangent = edge1
          .scale(deltaUV2.y)
          .subtract(edge2.scale(deltaUV1.y))
          .scale(invDet);
        faceBitangent = edge2
          .scale(deltaUV1.x)
          .subtract(edge1.scale(deltaUV2.x))
          .scale(invDet);
      } else {
        const fallbackNormal = normals[i];
        faceTangent = getFallbackTangent(fallbackNormal);
        faceBitangent = fallbackNormal.cross(faceTangent).normalize();
      }

      for (let j = 0; j < 3; j++) {
        const key = tangentKeys[i + j];
        const tangentSum = tangentSums.get(key) ?? new Vector3();
        tangentSum.addInPlace(faceTangent);
        tangentSums.set(key, tangentSum);

        const bitangentSum = bitangentSums.get(key) ?? new Vector3();
        bitangentSum.addInPlace(faceBitangent);
        bitangentSums.set(key, bitangentSum);
      }
    }

    for (let i = 0; i < vertices.length; i++) {
      const normal = normals[i];
      const tangentSum =
        tangentSums.get(tangentKeys[i]) ?? getFallbackTangent(normal);
      const bitangentSum = bitangentSums.get(tangentKeys[i]);

      let tangent = tangentSum.subtract(normal.scale(normal.dot(tangentSum)));
      if (tangent.lengthSq() < 0.00000001) {
        tangent = getFallbackTangent(normal);
      } else {
        tangent = tangent.normalize();
      }

      const canonicalBitangent = normal.cross(tangent).normalize();
      const bitangentHandedness =
        bitangentSum &&
        canonicalBitangent.dot(
          bitangentSum.subtract(normal.scale(normal.dot(bitangentSum))),
        ) < 0
          ? -1
          : 1;
      const bitangent = canonicalBitangent.scale(bitangentHandedness);

      tangents.push(tangent);
      bitangents.push(bitangent);
    }
  } else {
    for (let i = 0; i < vertices.length; i++) {
      const normal = normals[i];
      const tangent = getFallbackTangent(normal);
      const bitangent = normal.cross(tangent).normalize();
      tangents.push(tangent);
      bitangents.push(bitangent);
    }
  }

  return { vertices, normals, faceNormals, uvs, tangents, bitangents };
};
