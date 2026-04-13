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

export interface FramebufferOptions {
  width: number;
  height: number;
  data?: Uint8ClampedArray;
  region?: BufferRegion;
}

export interface BufferRegion {
  x: number;
  y: number;
  width: number;
  height: number;
}

const linearToSrgb8 = (value: number) => {
  const clamped = saturate(value);
  const index = Math.round(clamped * SRGB8_LUT_MAX_INDEX);
  return srgb8Lut[index];
};

export class Framebuffer {
  width: number;
  height: number;
  totalPixels: number;
  data: Uint8ClampedArray;
  clipMinX: number;
  clipMinY: number;
  clipMaxX: number;
  clipMaxY: number;
  regionWidth: number;
  regionHeight: number;

  constructor(source: ImageData | FramebufferOptions) {
    if (source instanceof ImageData) {
      this.width = source.width;
      this.height = source.height;
      this.data = source.data;
      this.clipMinX = 0;
      this.clipMinY = 0;
      this.regionWidth = source.width;
      this.regionHeight = source.height;
    } else {
      const region = source.region ?? {
        x: 0,
        y: 0,
        width: source.width,
        height: source.height,
      };

      this.width = source.width;
      this.height = source.height;
      this.regionWidth = region.width;
      this.regionHeight = region.height;
      this.data = source.data ?? new Uint8ClampedArray(region.width * region.height * 4);
      this.clipMinX = region.x;
      this.clipMinY = region.y;
    }

    this.clipMaxX = this.clipMinX + this.regionWidth - 1;
    this.clipMaxY = this.clipMinY + this.regionHeight - 1;
    this.totalPixels = this.regionWidth * this.regionHeight;
  }

  setPixel = (x: number, y: number, color: Vector3) => {
    if (!this.contains(x, y)) {
      return;
    }

    const index = (x - this.clipMinX + (y - this.clipMinY) * this.regionWidth) * 4;
    this.data[index + 0] = linearToSrgb8(color.x);
    this.data[index + 1] = linearToSrgb8(color.y);
    this.data[index + 2] = linearToSrgb8(color.z);
    this.data[index + 3] = 255;
  };

  clear = () => {
    this.data.fill(0);
  };

  copyFrom = (src: Framebuffer) => {
    this.data.set(src.data);
  };

  copyFromRgba = (src: Uint8ClampedArray, srcWidth: number) => {
    if (
      this.regionWidth === this.width &&
      this.regionHeight === this.height &&
      srcWidth === this.width
    ) {
      this.data.set(src);
      return;
    }

    const rowWidth = this.regionWidth * 4;
    for (let y = 0; y < this.regionHeight; y += 1) {
      const srcStart = ((this.clipMinY + y) * srcWidth + this.clipMinX) * 4;
      const destStart = y * rowWidth;
      this.data.set(src.subarray(srcStart, srcStart + rowWidth), destStart);
    }
  };

  contains = (x: number, y: number) => {
    return x >= this.clipMinX && x <= this.clipMaxX && y >= this.clipMinY && y <= this.clipMaxY;
  };

  viewportTransform = (v: Vector4) => {
    const x = (v.x + 1) * (this.width * 0.5);
    const y = (-v.y + 1) * (this.height * 0.5);
    return new Vector4(x, y, v.z, v.w);
  };
}
