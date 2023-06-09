import { Vector3 } from "../maths";

export const loadObj = (file: string) => {
  const vertices: Vector3[] = [];
  const triangles: number[] = [];

  const lines = file.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const split = lines[i].trim().split(/\s+/);
    const isQuad = split.length === 5;
    if (split[0] == "v") {
      vertices.push(new Vector3(+split[1], +split[2], +split[3]));
    } else if (split[0] == "f") {
      // Check if quad
      if (isQuad) {
        // Quads
        triangles.push(
          +split[1].split("/")[0] - 1,
          +split[2].split("/")[0] - 1,
          +split[3].split("/")[0] - 1
        );
        triangles.push(
          +split[1].split("/")[0] - 1,
          +split[3].split("/")[0] - 1,
          +split[4].split("/")[0] - 1
        );
      } else {
        // Triangles
        triangles.push(
          +split[1].split("/")[0] - 1,
          +split[2].split("/")[0] - 1,
          +split[3].split("/")[0] - 1
        );
      }
    }
  }
  return { vertices, triangles };
};
