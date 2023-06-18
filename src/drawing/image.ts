import { Vector3 } from "../maths";

export const setPixel = (
  x: number,
  y: number,
  colour: Vector3,
  image: ImageData
) => {
  const index = (x + y * image.width) * 4;
  image.data[index + 0] = colour.x * 255;
  image.data[index + 1] = colour.y * 255;
  image.data[index + 2] = colour.z * 255;
};

export const clear = (image: ImageData, zBuffer: Float32Array) => {
  image.data.fill(0);
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = 255;
  }
  zBuffer.fill(1000);
};

export const viewportTransform = (v: Vector3, image: ImageData) => {
  const x = (v.x + 1) * (image.width * 0.5);
  const y = (-v.y + 1) * (image.height * 0.5);
  return new Vector3(x, y, v.z);
};
