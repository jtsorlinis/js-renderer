import { Vector3 } from "../maths";

export const loadObj = (file: string) => {
  const vertices: Vector3[] = [];
  const normals: Vector3[] = [];

  const tempVerts: Vector3[] = [];
  const tempNormals: Vector3[] = [];
  const tempTris: number[] = [];
  const tempNormalTris: number[] = [];

  const lines = file.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const split = lines[i].trim().split(/\s+/);
    const isQuad = split.length === 5;
    if (split[0] == "v") {
      tempVerts.push(new Vector3(+split[1], +split[2], +split[3]));
    } else if (split[0] == "vn") {
      tempNormals.push(new Vector3(+split[1], +split[2], +split[3]));
    } else if (split[0] == "f") {
      // Check if quad
      if (isQuad) {
        // Quads
        tempTris.push(
          +split[1].split("/")[0] - 1,
          +split[2].split("/")[0] - 1,
          +split[3].split("/")[0] - 1
        );
        tempTris.push(
          +split[1].split("/")[0] - 1,
          +split[3].split("/")[0] - 1,
          +split[4].split("/")[0] - 1
        );

        // Add normals
        tempNormalTris.push(
          +split[1].split("/")[2] - 1,
          +split[2].split("/")[2] - 1,
          +split[3].split("/")[2] - 1
        );
        tempNormalTris.push(
          +split[1].split("/")[2] - 1,
          +split[3].split("/")[2] - 1,
          +split[4].split("/")[2] - 1
        );
      } else {
        // Triangles
        tempTris.push(
          +split[1].split("/")[0] - 1,
          +split[2].split("/")[0] - 1,
          +split[3].split("/")[0] - 1
        );

        // Add normals
        tempNormalTris.push(
          +split[1].split("/")[2] - 1,
          +split[2].split("/")[2] - 1,
          +split[3].split("/")[2] - 1
        );
      }
    }
  }

  // rebuild vertices and normals
  for (let i = 0; i < tempTris.length; i++) {
    const vert = tempVerts[tempTris[i]];
    const normal = tempNormals[tempNormalTris[i]];
    vertices.push(vert);
    normals.push(normal);
  }

  return { vertices, normals };
};
