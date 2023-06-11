import { Vector3, Matrix4 } from "./maths";

export interface Uniforms {
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
  // const intensity = -normal.dot(params.lightDir);
  // const colour = params.lightCol.scale(intensity);
  const colour = new Vector3(1, 1, 1);

  return { position, normal, colour };
};

export const fragShader = (c: Vector3, n: Vector3, params: Uniforms) => {
  const intensity = -n.dot(params.lightDir);
  return c.scale(intensity);
};
