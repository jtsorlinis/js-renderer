import { Vector3 } from "../maths";

export class Texture {
  data: Vector3[];
  width: number;
  height: number;

  constructor() {
    this.data = [];
    this.width = 0;
    this.height = 0;
  }

  setData = async (imageURL: string) => {
    const img = new Image();
    img.src = imageURL;
    await img.decode();
    const offScreenCanvas = new OffscreenCanvas(img.width, img.height);
    const offScreenCtx = offScreenCanvas.getContext("2d");
    if (!offScreenCtx) {
      throw new Error("Could not get texture context");
    }
    offScreenCtx.drawImage(img, 0, 0);
    const imageData = offScreenCtx.getImageData(0, 0, img.width, img.height);

    this.data = [];
    this.width = imageData.width;
    this.height = imageData.height;

    for (let i = 0; i < imageData.data.length; i += 4) {
      this.data.push(
        new Vector3(
          imageData.data[i] / 255,
          imageData.data[i + 1] / 255,
          imageData.data[i + 2] / 255
        )
      );
    }
  };
}
