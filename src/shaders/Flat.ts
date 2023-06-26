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

const specStr = 0.2;
const ambient = 0.1;

export class FlatShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // No interpolation needed for flat shading
  lighting = 0;

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = this.uniforms.normalMat
      .multiplyDirection(model.faceNormals[i])
      .normalize();
    const worldPos = this.uniforms.mvp.multiplyPoint(model.vertices[i]);

    // Calculate lighting
    const viewDir = this.uniforms.camPos.subtract(worldPos.xyz).normalize();
    const reflectDir = this.uniforms.lightDir.reflect(normal);
    const spec = Math.pow(Math.max(viewDir.dot(reflectDir), 0), 32) * specStr;

    const diffuse = Math.max(-normal.dot(this.uniforms.lightDir), 0);

    this.lighting = diffuse + spec + ambient;

    return this.uniforms.mvp.multiplyPoint(model.vertices[i]);
  };

  fragment = () => {
    return this.uniforms.lightCol.scale(this.lighting);
  };
}
