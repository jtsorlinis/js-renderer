import { Vector3, Vector4 } from "../maths";
import { linearToSrgb } from "./Texture";

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

  setPixel = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb(color.x) * 255;
    this.data[index + 1] = linearToSrgb(color.y) * 255;
    this.data[index + 2] = linearToSrgb(color.z) * 255;
    this.data[index + 3] = 255;
  };

  clear = () => {
    this.data.fill(0);
  };

  copyFrom = (src: Framebuffer) => {
    this.data.set(src.data);
  };

  viewportTransform = (v: Vector4) => {
    const x = (v.x + 1) * (this.width * 0.5);
    const y = (-v.y + 1) * (this.height * 0.5);
    return new Vector4(x, y, v.z, v.w);
  };
}
