import { Vector3 } from "../maths";

const DEFAULT_TEXTURE_SIZE_LIMIT = 1024;
const HIGH_RES_TEXTURE_SIZE_LIMIT = 2048;
let textureSizeLimit = DEFAULT_TEXTURE_SIZE_LIMIT;

export const setHighResTextureLimit = (enabled: boolean) => {
  textureSizeLimit = enabled
    ? HIGH_RES_TEXTURE_SIZE_LIMIT
    : DEFAULT_TEXTURE_SIZE_LIMIT;
};

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

  constructor(data: Vector3[], width: number, height: number) {
    this.data = data;
    this.width = width;
    this.height = height;
  }

  static Load = async (imageURL: string, isNormalMap = false) => {
    const img = new Image();
    img.src = imageURL;
    await img.decode();
    const scale =
      Math.max(img.width, img.height) > textureSizeLimit
        ? textureSizeLimit / Math.max(img.width, img.height)
        : 1;
    const targetWidth = Math.max(1, Math.round(img.width * scale));
    const targetHeight = Math.max(1, Math.round(img.height * scale));
    const offScreenCanvas = new OffscreenCanvas(targetWidth, targetHeight);
    const offScreenCtx = offScreenCanvas.getContext("2d");
    if (!offScreenCtx) {
      throw new Error("Could not get texture context");
    }
    offScreenCtx.imageSmoothingEnabled = true;
    offScreenCtx.imageSmoothingQuality = "high";
    offScreenCtx.drawImage(img, 0, 0, targetWidth, targetHeight);
    const imageData = offScreenCtx.getImageData(0, 0, targetWidth, targetHeight);
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

    return new Texture(data, targetWidth, targetHeight);
  };
}
