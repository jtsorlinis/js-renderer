export class Colour {
  r: number;
  g: number;
  b: number;

  constructor(r?: number, g?: number, b?: number) {
    this.r = r ?? 0;
    this.g = g ?? 0;
    this.b = b ?? 0;
  }
}
