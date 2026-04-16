import { saturate, Vector3, Vector4 } from "../maths";

const linearToSrgb = (value: number) => {
  const clamped = Math.max(0, value);
  if (clamped <= 0.0031308) {
    return clamped * 12.92;
  }
  return 1.055 * Math.pow(clamped, 1 / 2.4) - 0.055;
};

const SRGB8_LUT_SIZE = 4096;
const SRGB8_LUT_MAX_INDEX = SRGB8_LUT_SIZE - 1;
const srgb8Lut = new Uint8Array(SRGB8_LUT_SIZE);

for (let i = 0; i < SRGB8_LUT_SIZE; i += 1) {
  srgb8Lut[i] = Math.round(linearToSrgb(i / SRGB8_LUT_MAX_INDEX) * 255);
}

const linearToSrgb8 = (value: number) => {
  const clamped = saturate(value);
  const index = Math.round(clamped * SRGB8_LUT_MAX_INDEX);
  return srgb8Lut[index];
};

const quantize5 = (value: number) => {
  return Math.round(saturate(value) * 31) / 31;
};

const quantize4 = (value: number) => {
  return Math.round(saturate(value) * 15) / 15;
};

const bayer4x4 = new Uint8Array([0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5]);

const quantizeOrdered = (value: number, maxLevel: number, x: number, y: number) => {
  const scaled = saturate(value) * maxLevel;
  const baseLevel = Math.floor(scaled);
  const fraction = scaled - baseLevel;
  const threshold = (bayer4x4[(x & 3) + ((y & 3) << 2)] + 0.5) / bayer4x4.length;
  const level = Math.min(maxLevel, baseLevel + (fraction > threshold ? 1 : 0));
  return level / maxLevel;
};

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

  tonemapAces = (val: number) =>
    saturate((val * (2.51 * val + 0.03)) / (val * (2.43 * val + 0.59) + 0.14));

  setPixelAces = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb8(this.tonemapAces(color.x));
    this.data[index + 1] = linearToSrgb8(this.tonemapAces(color.y));
    this.data[index + 2] = linearToSrgb8(this.tonemapAces(color.z));
    this.data[index + 3] = 255;
  };

  setPixelQuantize5 = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb8(quantize5(color.x));
    this.data[index + 1] = linearToSrgb8(quantize5(color.y));
    this.data[index + 2] = linearToSrgb8(quantize5(color.z));
    this.data[index + 3] = 255;
  };

  setPixelQuantize5Dither = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb8(quantizeOrdered(color.x, 31, x, y));
    this.data[index + 1] = linearToSrgb8(quantizeOrdered(color.y, 31, x, y));
    this.data[index + 2] = linearToSrgb8(quantizeOrdered(color.z, 31, x, y));
    this.data[index + 3] = 255;
  };

  setPixelQuantize4 = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb8(quantize4(color.x));
    this.data[index + 1] = linearToSrgb8(quantize4(color.y));
    this.data[index + 2] = linearToSrgb8(quantize4(color.z));
    this.data[index + 3] = 255;
  };

  setPixelQuantize4Dither = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb8(quantizeOrdered(color.x, 15, x, y));
    this.data[index + 1] = linearToSrgb8(quantizeOrdered(color.y, 15, x, y));
    this.data[index + 2] = linearToSrgb8(quantizeOrdered(color.z, 15, x, y));
    this.data[index + 3] = 255;
  };

  setPixel = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    this.data[index + 0] = linearToSrgb8(color.x);
    this.data[index + 1] = linearToSrgb8(color.y);
    this.data[index + 2] = linearToSrgb8(color.z);
    this.data[index + 3] = 255;
  };

  clear = () => {
    this.data.fill(0);
  };

  fadeToBlack = (amount: number) => {
    for (let i = 0; i < this.data.length; i += 4) {
      this.data[i + 0] -= amount * 255;
      this.data[i + 1] -= amount * 255;
      this.data[i + 2] -= amount * 255;
    }
  };

  copyFrom = (src: Framebuffer) => {
    this.data.set(src.data);
  };

  viewportTransform = (v: Vector4) => {
    const x = (v.x + 1) * (this.width * 0.5);
    const y = (-v.y + 1) * (this.height * 0.5);
    return new Vector4(x, y, v.z, v.w);
  };

  snapToPixelGrid = (v: Vector4) => {
    const halfWidth = this.width * 0.5;
    const halfHeight = this.height * 0.5;
    const screenX = (v.x + 1) * halfWidth;
    const screenY = (-v.y + 1) * halfHeight;
    const snappedX = Math.round(screenX);
    const snappedY = Math.round(screenY);

    v.x = snappedX / halfWidth - 1;
    v.y = 1 - snappedY / halfHeight;
    return v;
  };
}
