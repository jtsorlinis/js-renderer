import { Vector3 } from "../maths";
import model from "./head_model.obj?raw";

export const loadHead = () => {
  const vertices: Vector3[] = [];
  const faces: Vector3[] = [];

  const lines = model.split("\n");
  for (let i = 0; i < lines.length; i++) {
    const split = lines[i].split(" ");
    if (split[0] == "v") {
      vertices.push(new Vector3(+split[1], +split[2], +split[3]));
    } else if (split[0] == "f") {
      faces.push(
        new Vector3(
          +split[1].split("/")[0] - 1,
          +split[2].split("/")[0] - 1,
          +split[3].split("/")[0] - 1
        )
      );
    }
  }
  return { vertices, faces };
};
