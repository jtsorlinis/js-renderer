const TEXTURE_SIZE_LIMIT = 2048;

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
      Math.max(img.width, img.height) > TEXTURE_SIZE_LIMIT
        ? TEXTURE_SIZE_LIMIT / Math.max(img.width, img.height)
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
    const pixels = offScreenCtx.getImageData(0, 0, targetWidth, targetHeight).data;

    // Channels are bytes, so decode each of the 256 values once
    const decoded = new Float32Array(256);
    for (let byte = 0; byte < 256; byte++) {
      const value = byte / 255;
      if (descriptor.type === "normal") {
        decoded[byte] = value * 2 - 1;
      } else {
        decoded[byte] = descriptor.colorSpace === "srgb" ? srgbToLinear(value) : value;
      }
    }

    const data = new Float32Array((pixels.length / 4) * 3);
    let dataIndex = 0;
    for (let i = 0; i < pixels.length; i += 4) {
      data[dataIndex++] = decoded[pixels[i]];
      data[dataIndex++] = decoded[pixels[i + 1]];
      data[dataIndex++] = decoded[pixels[i + 2]];
    }
    return new Texture(data, targetWidth, targetHeight);
  };
}
