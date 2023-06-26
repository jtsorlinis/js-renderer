export class Vector2 {
  x: number;
  y: number;

  constructor(x?: number, y?: number) {
    this.x = x ?? 0;
    this.y = y ?? 0;
  }

  public add(v: Vector2) {
    return new Vector2(this.x + v.x, this.y + v.y);
  }

  public addScalar(s: number) {
    return new Vector2(this.x + s, this.y + s);
  }

  public subtract(v: Vector2) {
    return new Vector2(this.x - v.x, this.y - v.y);
  }

  public dot(v: Vector2) {
    return this.x * v.x + this.y * v.y;
  }

  // Technically 2D vectors don't have a cross product, but we can assume z = 0
  public cross(v: Vector2) {
    return this.x * v.y - this.y * v.x;
  }

  public clone() {
    return new Vector2(this.x, this.y);
  }

  public truncate() {
    return new Vector2(~~this.x, ~~this.y);
  }

  public scale(s: number) {
    return new Vector2(this.x * s, this.y * s);
  }

  public scaleInPlace(s: number) {
    this.x *= s;
    this.y *= s;
    return this;
  }
}
