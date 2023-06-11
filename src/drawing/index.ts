import { Vector3 } from "../maths";
import { clear, setPixel } from "./image";
import { line, triangle } from "./rasterization";
export { clear, setPixel, line, triangle };

export interface Barycentric {
  u: number;
  v: number;
  w: number;
}

export const viewportTransform = (v: Vector3, image: ImageData) => {
  const x = (v.x * image.width) / 2 + image.width / 2;
  const y = (-v.y * image.height) / 2 + image.height / 2;
  return new Vector3(x, y, v.z);
};
