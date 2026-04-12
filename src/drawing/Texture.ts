const DEFAULT_TEXTURE_SIZE_LIMIT = 1024;
const HIGH_RES_TEXTURE_SIZE_LIMIT = 2048;
let textureSizeLimit = DEFAULT_TEXTURE_SIZE_LIMIT;

export type TextureType = "color" | "normal";
export type TextureColorSpace = "linear" | "srgb";

export interface TextureDescriptor {
  type: TextureType;
  colorSpace: TextureColorSpace;
}

const srgbToLinear = (value: number) => {
  if (value <= 0.04045) {
    return value / 12.92;
  }

  return Math.pow((value + 0.055) / 1.055, 2.4);
};

// Fast approximation but looks visually identical
export const linearToSrgb = (value: number) => {
  const S1 = Math.sqrt(value);
  const S2 = Math.sqrt(S1);
  const S3 = Math.sqrt(S2);
  return 0.662002687 * S1 + 0.68412206 * S2 - 0.323583601 * S3 - 0.022541147 * value;
};

export const setHighResTextureLimit = (enabled: boolean) => {
  textureSizeLimit = enabled ? HIGH_RES_TEXTURE_SIZE_LIMIT : DEFAULT_TEXTURE_SIZE_LIMIT;
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
  data: Float32Array;
  width: number;
  height: number;

  constructor(data: Float32Array, width: number = 1, height: number = 1) {
    this.data = data;
    this.width = width;
    this.height = height;
  }

  static get White() {
    return new Texture(new Float32Array([1, 1, 1]));
  }

  static get Normal() {
    return new Texture(new Float32Array([0, 0, 1]));
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
    const imageData = offScreenCtx.getImageData(0, 0, targetWidth, targetHeight);
    const data = new Float32Array((imageData.data.length / 4) * 3);
    let dataIndex = 0;
    for (let i = 0; i < imageData.data.length; i += 4) {
      if (descriptor.type === "normal") {
        data[dataIndex++] = (imageData.data[i] / 255) * 2 - 1;
        data[dataIndex++] = (imageData.data[i + 1] / 255) * 2 - 1;
        data[dataIndex++] = (imageData.data[i + 2] / 255) * 2 - 1;
      } else {
        let r = imageData.data[i] / 255;
        let g = imageData.data[i + 1] / 255;
        let b = imageData.data[i + 2] / 255;
        if (descriptor.colorSpace === "srgb") {
          r = srgbToLinear(r);
          g = srgbToLinear(g);
          b = srgbToLinear(b);
        }

        data[dataIndex++] = r;
        data[dataIndex++] = g;
        data[dataIndex++] = b;
      }
    }
    return new Texture(data, targetWidth, targetHeight);
  };
}
