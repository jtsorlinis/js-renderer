import { Vector3 } from "../maths";

const DEFAULT_TEXTURE_SIZE_LIMIT = 1024;
const HIGH_RES_TEXTURE_SIZE_LIMIT = 2048;
let textureSizeLimit = DEFAULT_TEXTURE_SIZE_LIMIT;

export type TextureType = "color" | "normal";
export type TextureColorSpace = "linear" | "srgb";

export interface TextureDescriptor {
  type: TextureType;
  colorSpace: TextureColorSpace;
}

const srgbChannelToLinear = (value: number) => {
  if (value <= 0.04045) {
    return value / 12.92;
  }

  return Math.pow((value + 0.055) / 1.055, 2.4);
};

export const linearChannelToSrgb = (value: number) => {
  const clamped = Math.min(1, Math.max(0, value));
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }

  return 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
};

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

  static Load = async (imageURL: string, descriptor: TextureDescriptor) => {
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
    const imageData = offScreenCtx.getImageData(
      0,
      0,
      targetWidth,
      targetHeight,
    );
    const data = [];
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (descriptor.type === "normal") {
        const normal = new Vector3(
          (imageData.data[i] / 255) * 2 - 1,
          (imageData.data[i + 1] / 255) * 2 - 1,
          (imageData.data[i + 2] / 255) * 2 - 1,
        ).normalize();
        data.push(normal);
      } else {
        let r = imageData.data[i] / 255;
        let g = imageData.data[i + 1] / 255;
        let b = imageData.data[i + 2] / 255;
        if (descriptor.colorSpace === "srgb") {
          r = srgbChannelToLinear(r);
          g = srgbChannelToLinear(g);
          b = srgbChannelToLinear(b);
        }

        data.push(new Vector3(r, g, b));
      }
    }
    return new Texture(data, targetWidth, targetHeight);
  };
}
