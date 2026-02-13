import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4 } from "../maths";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  camPos: Vector3;
}

const specStr = 0.25;
const shininess = 16;
const ambient = 0.1;
const smoothScale = 0.8;

export class FlatShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  // Flat shading stores one lighting value for the whole triangle.
  lighting = 0;

  vertex = (): Vector4 => {
    // Use face normal so every pixel in this triangle gets identical lighting.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = this.uniforms.normalMat
      .multiplyDirection(model.faceNormals[i])
      .normalize();
    const worldPos = this.uniforms.mvp.multiplyPoint(model.vertices[i]);

    // Compute lighting once in vertex stage for this face.
    const viewDir = this.uniforms.camPos.subtract(worldPos.xyz).normalize();
    const halfWayDir = viewDir.subtract(this.uniforms.lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    const diffuse = Math.max(-normal.dot(this.uniforms.lightDir), 0);
    this.lighting = (diffuse + spec + ambient) * smoothScale;

    // Return clip-space position.
    return this.uniforms.mvp.multiplyPoint(model.vertices[i]);
  };

  fragment = () => {
    return this.uniforms.lightCol.scale(this.lighting);
  };
}
