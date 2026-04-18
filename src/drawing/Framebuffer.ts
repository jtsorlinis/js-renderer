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

export const linearToSrgb8 = (value: number) => {
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

  constructor(width: number, height: number) {
    this.imageData = new ImageData(width, height);
    this.width = this.imageData.width;
    this.height = this.imageData.height;
    this.totalPixels = this.width * this.height;
  }

  setPixelTonemapped = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
    const tmColor = tonemapKhronosPbrNeutral(color);
    this.imageData.data[index + 0] = linearToSrgb8(tmColor.x);
    this.imageData.data[index + 1] = linearToSrgb8(tmColor.y);
    this.imageData.data[index + 2] = linearToSrgb8(tmColor.z);
    this.imageData.data[index + 3] = 255;
  };

  setPixel = (x: number, y: number, color: Vector3) => {
    const index = (x + y * this.width) * 4;
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

  viewportTransform = (v: Vector4) => {
    const x = (v.x + 1) * (this.width * 0.5);
    const y = (-v.y + 1) * (this.height * 0.5);
    return new Vector4(x, y, v.z, v.w);
  };
}
