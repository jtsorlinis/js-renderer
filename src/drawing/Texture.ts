import { Vector3 } from "../maths";

export class DepthTexture {
  data: Float32Array;
  width: number;
  height: number;

  constructor(width: number, height: number) {
    this.data = new Float32Array(width * height);
    this.width = width;
    this.height = height;
  }

  clear(val: number) {
    this.data.fill(val);
  }
}

export class Texture {
  data: Vector3[];
  width: number;
  height: number;

  private constructor(data: Vector3[], width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }

  static Load = async (imageURL: string, isNormalMap = false) => {
    const img = new Image();
    img.src = imageURL;
    await img.decode();
    const offScreenCanvas = new OffscreenCanvas(img.width, img.height);
    const offScreenCtx = offScreenCanvas.getContext("2d");
    if (!offScreenCtx) {
      throw new Error("Could not get texture context");
    }
    offScreenCtx.drawImage(img, 0, 0);
    const imageData = offScreenCtx.getImageData(0, 0, img.width, img.height);
    const data = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (isNormalMap) {
        const normal = new Vector3(
          (imageData.data[i] / 255) * 2 - 1,
          (imageData.data[i + 1] / 255) * 2 - 1,
          (imageData.data[i + 2] / 255) * 2 - 1
        ).normalize();
        data.push(normal);
      } else {
        data.push(
          new Vector3(
            imageData.data[i] / 255,
            imageData.data[i + 1] / 255,
            imageData.data[i + 2] / 255
          )
        );
      }
    }

    return new Texture(data, img.width, img.height);
  };
}
