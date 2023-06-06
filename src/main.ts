import "./style.css";
import { Vector3 } from "./maths";
import { Colour, clear, line, triangle } from "./drawing";
import { loadHead } from "./models/objLoader";
import { Matrix4 } from "./maths/Matrix4";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const ctx = canvas.getContext("2d");
if (!ctx) {
  throw new Error("Could not get canvas context");
}

// Setup canvas and zBuffer
const image = new ImageData(canvas.width, canvas.height);
const zBuffer = new Float32Array(canvas.width * canvas.height);
const drawWireframe = false;
const isOrtho = false;

// Head model
const headModel = loadHead();
let headRot = new Vector3(0, 3.141, 0);

const update = (dt: number) => {
  headRot.y += dt / 5;
  // headRot.x += dt / 5;
  // headRot.z += dt / 5;
};

const lightDir = new Vector3(0, 0, 1);
const camPos = new Vector3(0, 0, -2.5);

const draw = () => {
  clear(image, zBuffer);

  const modelMat = Matrix4.TRS(Vector3.Zero, headRot, Vector3.One);
  const viewMat = Matrix4.LookAt(camPos, Vector3.Zero, Vector3.Up);
  const projMat = isOrtho
    ? Matrix4.Ortho(1.5, image)
    : Matrix4.Perspective(60, image);

  const mvp = modelMat.multiply(viewMat).multiply(projMat);

  for (let i = 0; i < headModel.faces.length; i++) {
    const face = headModel.faces[i];

    // Model space
    const m1 = headModel.vertices[face.x];
    const m2 = headModel.vertices[face.y];
    const m3 = headModel.vertices[face.z];

    // World space
    const w1 = modelMat.multiplyVector(m1);
    const w2 = modelMat.multiplyVector(m2);
    const w3 = modelMat.multiplyVector(m3);

    // Screen space
    const v1 = mvp.multiplyVector(m1);
    const v2 = mvp.multiplyVector(m2);
    const v3 = mvp.multiplyVector(m3);

    if (drawWireframe) {
      // Draw wireframe
      line(v1, v2, new Colour(255, 255, 255), image);
      line(v2, v3, new Colour(255, 255, 255), image);
      line(v3, v1, new Colour(255, 255, 255), image);
    } else {
      // Draw filled
      const edge1 = w3.subtract(w1);
      const edge2 = w2.subtract(w1);
      const n = edge1.cross(edge2).normalize();
      const intensity = n.dot(lightDir);
      const col = new Colour(intensity * 255, intensity * 255, intensity * 255);
      triangle(v1, v2, v3, zBuffer, col, image);
    }
  }
  ctx.putImageData(image, 0, 0);
};

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
