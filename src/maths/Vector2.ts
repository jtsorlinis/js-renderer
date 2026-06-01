export class Vector2 {
  x: number;
  y: number;

  constructor(x: number = 0, y: number = 0) {
    this.x = x;
    this.y = y;
  }

  public subtract(v: Vector2) {
    return new Vector2(this.x - v.x, this.y - v.y);
  }

  public clone() {
    return new Vector2(this.x, this.y);
  }
}
