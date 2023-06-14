import { Vector3 } from ".";

export class Vector4 {
  x: number;
  y: number;
  z: number;
  w: number;

  static get Zero() {
    return new Vector4(0, 0, 0, 0);
  }

  constructor(x?: number, y?: number, z?: number, w?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = z ?? 0;
    this.w = w ?? 0;
  }

  public get xyz() {
    return new Vector3(this.x, this.y, this.z);
  }

  public divideByW() {
    const invW = 1 / this.w;
    return new Vector3(this.x * invW, this.y * invW, this.z * invW);
  }
}
