import "./style.css";
import { Vector2 } from "./maths";
import { Colour, clear, triangle } from "./drawing";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

let image = new ImageData(canvas.width, canvas.height);

const update = () => {};

const draw = () => {
  clear(image);
  triangle(
    new Vector2(300, 400),
    new Vector2(400, 200),
    new Vector2(500, 400),
    new Colour(255, 0, 0),
    image
  );
  triangle(
    new Vector2(100, 100),
    new Vector2(250, 150),
    new Vector2(150, 250),
    new Colour(0, 255, 0),
    image
  );
  ctx.putImageData(image, 0, 0);
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  fpsText.innerHTML = dt.toFixed(3);
  prevTime = now;
  update();
  draw();
  requestAnimationFrame(loop);
};

loop();
