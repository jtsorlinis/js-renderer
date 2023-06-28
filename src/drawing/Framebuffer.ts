import { Vector3, Vector4 } from "../maths";

export class Framebuffer {
  width: number;
  height: number;
  totalPixels: number;
  data: Uint8ClampedArray;

  constructor(imageData: ImageData) {
    this.width = imageData.width;
    this.height = imageData.height;
    this.totalPixels = this.width * this.height;
    this.data = imageData.data;
  }

  setPixel = (x: number, y: number, colour: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = colour.x * 255;
    this.data[index + 1] = colour.y * 255;
    this.data[index + 2] = colour.z * 255;
  };

  clear = () => {
    this.data.fill(0);
    for (let i = 3; i < this.totalPixels * 4; i += 4) {
      this.data[i] = 255;
    }
  };

  viewportTransform = (v: Vector4) => {
    const x = (v.x + 1) * (this.width * 0.5);
    const y = (-v.y + 1) * (this.height * 0.5);
    return new Vector4(x, y, v.z, v.w);
  };
}
