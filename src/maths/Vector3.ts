export class Vector3 {
  x: number;
  y: number;
  z: number;

  static get Zero() {
    return new Vector3(0, 0, 0);
  }

  static get One() {
    return new Vector3(1, 1, 1);
  }

  static get Up() {
    return new Vector3(0, 1, 0);
  }

  static get Forward() {
    return new Vector3(0, 0, 1);
  }

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

  public scaleInPlace(s: number) {
    this.x *= s;
    this.y *= s;
    this.z *= s;
    return this;
  }

  public lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  public length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }

  public normalized() {
    const invLen = 1 / this.length();
    return new Vector3(this.x * invLen, this.y * invLen, this.z * invLen);
  }

  public normalize() {
    const invLen = 1 / this.length();
    this.x *= invLen;
    this.y *= invLen;
    this.z *= invLen;
    return this;
  }

  public translate(v: Vector3) {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  public dot(v: Vector3) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  public add(v: Vector3) {
    return new Vector3(this.x + v.x, this.y + v.y, this.z + v.z);
  }

  public addScalar(s: number) {
    return new Vector3(this.x + s, this.y + s, this.z + s);
  }

  public subtract(v: Vector3) {
    return new Vector3(this.x - v.x, this.y - v.y, this.z - v.z);
  }

  public multiply(v: Vector3) {
    return new Vector3(this.x * v.x, this.y * v.y, this.z * v.z);
  }

  public multiplyInPlace(v: Vector3) {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }

  public set(x: number, y: number, z: number) {
    this.x = x;
    this.y = y;
    this.z = z;
  }
}
