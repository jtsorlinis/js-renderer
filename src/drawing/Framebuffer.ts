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
  imageData?: ImageData;
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

const tonemapKhronosPbrNeutral = (color: Vector3) => {
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;

  const x = Math.min(color.x, Math.min(color.y, color.z));
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  color = color.subtract(new Vector3(offset, offset, offset));

  const peak = Math.max(color.x, Math.max(color.y, color.z));
  if (peak < startCompression) return color;

  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  color = color.scale(newPeak / peak);

  const g = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return color.scale(1 - g).add(new Vector3(g * newPeak, g * newPeak, g * newPeak));
};

export class Framebuffer {
  width: number;
  height: number;
  totalPixels: number;
  imageData: ImageData;
  clipMinX: number;
  clipMinY: number;
  clipMaxX: number;
  clipMaxY: number;
  regionWidth: number;
  regionHeight: number;

  constructor(width: number, height: number);
  constructor(source: ImageData | FramebufferOptions);
  constructor(sourceOrWidth: number | ImageData | FramebufferOptions, height?: number) {
    if (typeof sourceOrWidth === "number") {
      this.width = sourceOrWidth;
      this.height = height!;
      this.clipMinX = 0;
      this.clipMinY = 0;
      this.regionWidth = this.width;
      this.regionHeight = this.height;
      this.imageData = new ImageData(this.width, this.height);
    } else if (sourceOrWidth instanceof ImageData) {
      this.width = sourceOrWidth.width;
      this.height = sourceOrWidth.height;
      this.clipMinX = 0;
      this.clipMinY = 0;
      this.regionWidth = sourceOrWidth.width;
      this.regionHeight = sourceOrWidth.height;
      this.imageData = sourceOrWidth;
    } else {
      const source = sourceOrWidth;
      const region = source.region ?? {
        x: 0,
        y: 0,
        width: source.width,
        height: source.height,
      };

      this.width = source.width;
      this.height = source.height;
      this.clipMinX = region.x;
      this.clipMinY = region.y;
      this.regionWidth = region.width;
      this.regionHeight = region.height;
      this.imageData =
        source.imageData ??
        (source.data
          ? new ImageData(source.data as unknown as ImageDataArray, region.width, region.height)
          : new ImageData(region.width, region.height));
    }

    this.clipMaxX = this.clipMinX + this.regionWidth - 1;
    this.clipMaxY = this.clipMinY + this.regionHeight - 1;
    this.totalPixels = this.regionWidth * this.regionHeight;
  }

  setPixelTonemapped = (x: number, y: number, color: Vector3) => {
    if (!this.contains(x, y)) {
      return;
    }

    const index = (x - this.clipMinX + (y - this.clipMinY) * this.regionWidth) * 4;
    const tmColor = tonemapKhronosPbrNeutral(color);
    this.imageData.data[index + 0] = linearToSrgb8(tmColor.x);
    this.imageData.data[index + 1] = linearToSrgb8(tmColor.y);
    this.imageData.data[index + 2] = linearToSrgb8(tmColor.z);
    this.imageData.data[index + 3] = 255;
  };

  setPixel = (x: number, y: number, color: Vector3) => {
    if (!this.contains(x, y)) {
      return;
    }

    const index = (x - this.clipMinX + (y - this.clipMinY) * this.regionWidth) * 4;
    this.imageData.data[index + 0] = linearToSrgb8(color.x);
    this.imageData.data[index + 1] = linearToSrgb8(color.y);
    this.imageData.data[index + 2] = linearToSrgb8(color.z);
    this.imageData.data[index + 3] = 255;
  };

  clear = () => {
    this.imageData.data.fill(0);
  };

  copyFrom = (src: Framebuffer) => {
    this.imageData.data.set(src.imageData.data);
  };

  get data() {
    return this.imageData.data;
  }

  copyFromRgba = (src: Uint8ClampedArray, srcWidth: number) => {
    if (
      this.regionWidth === this.width &&
      this.regionHeight === this.height &&
      srcWidth === this.width
    ) {
      this.imageData.data.set(src);
      return;
    }

    const rowWidth = this.regionWidth * 4;
    for (let y = 0; y < this.regionHeight; y += 1) {
      const srcStart = ((this.clipMinY + y) * srcWidth + this.clipMinX) * 4;
      const destStart = y * rowWidth;
      this.imageData.data.set(src.subarray(srcStart, srcStart + rowWidth), destStart);
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
