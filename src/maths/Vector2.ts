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

  public subtract(v: Vector2) {
    return new Vector2(this.x - v.x, this.y - v.y);
  }

  public dot(v: Vector2) {
    return this.x * v.x + this.y * v.y;
  }

  public clone() {
    return new Vector2(this.x, this.y);
  }
}
