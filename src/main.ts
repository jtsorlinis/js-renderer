import "./style.css";
import { Vector3 } from "./maths";
import { Colour, clear, line, triangle } from "./drawing";
import { loadHead } from "./models/objLoader";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

// Head model
const headModel = loadHead();
const midPoint = new Vector3(canvas.width / 2, canvas.height / 2, 0);
const scale = 300;

const image = new ImageData(canvas.width, canvas.height);
const zBuffer = new Float32Array(canvas.width * canvas.height);

const draw = () => {
  clear(image, zBuffer);
  // triangle(
  //   new Vector3(300, 400),
  //   new Vector3(400, 200),
  //   new Vector3(500, 400),
  //   zBuffer,
  //   new Colour(255, 0, 0),
  //   image
  // );
  // triangle(
  //   new Vector3(100, 100),
  //   new Vector3(250, 150),
  //   new Vector3(150, 250),
  //   zBuffer,
  //   new Colour(0, 255, 0),
  //   image
  // );

  for (let i = 0; i < headModel.faces.length; i++) {
    const face = headModel.faces[i];
    const v1 = headModel.vertices[face.x].scale(scale).add(midPoint);
    const v2 = headModel.vertices[face.y].scale(scale).add(midPoint);
    const v3 = headModel.vertices[face.z].scale(scale).add(midPoint);

    // // Draw wireframe
    // line(v1, v2, new Colour(255, 255, 255), image);
    // line(v2, v3, new Colour(255, 255, 255), image);
    // line(v3, v1, new Colour(255, 255, 255), image);
    const edge1 = v3.subtract(v1);
    const edge2 = v2.subtract(v1);
    const n = edge1.cross(edge2).normalize();
    const lightDir = new Vector3(0, 0, 1);
    const intensity = n.dot(lightDir);

    // Draw filled
    triangle(
      v1,
      v2,
      v3,
      zBuffer,
      new Colour(intensity * 255, intensity * 255, intensity * 255),
      image
    );
  }
  ctx.putImageData(image, 0, 0);
};

const update = (dt: number) => {};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const dt = (now - prevTime) / 1000;
  fpsText.innerHTML = dt.toFixed(3);
  prevTime = now;
  update(dt);
  draw();
  requestAnimationFrame(loop);
};

loop();
