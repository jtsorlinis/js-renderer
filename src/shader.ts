import { Vector3, Matrix4 } from "./maths";

export interface Uniforms {
  mvp: Matrix4;
  rotMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
}

export interface Vertex {
  position: Vector3;
  normal: Vector3;
}

const vertex = (vert: Vertex, params: Uniforms) => {
  // Vertex transformation
  const position = params.mvp.multPerspectiveDiv(vert.position);
  const normal = params.rotMat.multiplyVector3(vert.normal);

  return { position, normal };
};

const fragment = (n: Vector3, params: Uniforms) => {
  const intensity = -n.dot(params.lightDir);
  return params.lightCol.scale(intensity);
};

export const shader = {
  vertex,
  fragment,
};
