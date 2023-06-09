import { Vector2, Vector3 } from "../maths";

export const setPixel = (pos: Vector2, colour: Vector3, image: ImageData) => {
  const index = (pos.x + pos.y * image.width) * 4;
  image.data[index + 0] = colour.x;
  image.data[index + 1] = colour.y;
  image.data[index + 2] = colour.z;
  image.data[index + 3] = 255;
};

export const clear = (image: ImageData, zBuffer: Float32Array) => {
  image.data.fill(0);
  for (let i = 3; i < image.data.length; i += 4) {
    image.data[i] = 255;
  }
  zBuffer.fill(1000);
};
