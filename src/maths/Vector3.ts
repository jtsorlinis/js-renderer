import { Vector2 } from ".";

export class Vector3 {
  x: number;
  y: number;
  z: number;

  constructor(x?: number, y?: number, z?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
    this.z = z ?? 0;
  }

  public cross(v: Vector3) {
    return new Vector3(
      this.y * v.z - this.z * v.y,
      this.z * v.x - this.x * v.z,
      this.x * v.y - this.y * v.x
    );
  }

  public clone() {
    return new Vector3(this.x, this.y, this.z);
  }

  public truncate() {
    return new Vector3(~~this.x, ~~this.y, ~~this.z);
  }

  public scale(s: number) {
    return new Vector3(this.x * s, this.y * s, this.z * s);
  }

  public lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  public length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  public normalize() {
    const l = this.length();
    return new Vector3(this.x / l, this.y / l, this.z / l);
  }

  public translate(v: Vector3) {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  public dot(v: Vector3) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  public xy() {
    return new Vector2(this.x, this.y);
  }

  public add(v: Vector3) {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  public subtract(v: Vector3) {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  public rotate(rot: Vector3) {
    const rz = new Vector3(
      this.x * Math.cos(rot.z) - this.y * Math.sin(rot.z),
      this.y * Math.cos(rot.z) + this.x * Math.sin(rot.z),
      this.z
    );

    const ry = new Vector3(
      rz.x * Math.cos(rot.y) + rz.z * Math.sin(rot.y),
      rz.y,
      rz.z * Math.cos(rot.y) - rz.x * Math.sin(rot.y)
    );

    const rx = new Vector3(
      ry.x,
      ry.y * Math.cos(rot.x) - ry.z * Math.sin(rot.x),
      ry.z * Math.cos(rot.x) + ry.y * Math.sin(rot.x)
    );

    return rx;
  }
}
