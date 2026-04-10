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

  public toArray() {
    return [this.x, this.y, this.z, this.w];
  }

  get xyz() {
    return new Vector3(this.x, this.y, this.z);
  }

  public dot3(v: Vector3) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  public normalize3() {
    const invLength = 1 / Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
    this.x *= invLength;
    this.y *= invLength;
    this.z *= invLength;
    return this;
  }

  truncate() {
    return new Vector4(~~this.x, ~~this.y, ~~this.z, ~~this.w);
  }

  // Converts clip space to NDC in place and keeps reciprocal W for perspective-correct interpolation.
  perspectiveDivide() {
    const invW = 1 / this.w;
    this.x *= invW;
    this.y *= invW;
    this.z *= invW;
    this.w = invW;
    return this;
  }

  divideByW() {
    const invW = 1 / this.w;
    return new Vector3(this.x * invW, this.y * invW, this.z * invW);
  }
}
