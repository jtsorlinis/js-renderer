import { Vector3, Matrix4 } from "./maths";

interface Uniforms {
  mvp: Matrix4;
  rotMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export const vertShader = (v: Vector3, n: Vector3, params: Uniforms) => {
  // Vertex transformation
  const position = params.mvp.multPerspectiveDiv(v);
  const normal = params.rotMat.multiplyVector3(n);

  // Vertex lighting
  const intensity = -normal.dot(params.lightDir);
  const colour = params.lightCol.scale(intensity).toRGB();

  return { position, normal, colour };
};
