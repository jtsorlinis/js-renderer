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
}
