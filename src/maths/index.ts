import { Vector2 } from "./Vector2";
import { Vector3 } from "./Vector3";
import { Vector4 } from "./Vector4";
import { Matrix4 } from "./Matrix4";

export { Vector2, Vector3, Vector4, Matrix4 };

export const clamp = (value: number, min: number, max: number) => {
  return Math.max(min, Math.min(max, value));
};

export const saturate = (value: number) => {
  return Math.max(0, Math.min(1, value));
};
