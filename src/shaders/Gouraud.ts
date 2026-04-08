import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4 } from "../maths";

export interface Uniforms {
  model: Verts;
  modelMat: Matrix4;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  camPos: Vector3;
  orthographic: boolean;
  viewDirWorld: Vector3;
}

const specStr = 0.5;
const shininess = 32;
const ambient = 0.1;
const baseColour = new Vector3(0.5, 0.5, 0.5);

export class GouraudShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  vertexColour = this.varying<Vector3>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;

    const worldPos = this.uniforms.modelMat.transformPoint(model.vertices[i]);
    const normal = this.uniforms.normalMat
      .transformDirection(model.normals[i])
      .normalize();

    const viewDir = this.uniforms.orthographic
      ? this.uniforms.viewDirWorld
      : this.uniforms.camPos.subtract(worldPos).normalize();
    const halfWayDir = viewDir.subtract(this.uniforms.lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    const diffuse = Math.max(-normal.dot(this.uniforms.lightDir), 0);
    const lighting = this.uniforms.lightCol.scale(diffuse + spec + ambient);
    const vertColour = baseColour.multiply(lighting);
    this.v2f(this.vertexColour, vertColour);

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[i]);
  };

  fragment = () => {
    return this.interpolateVec3(this.vertexColour);
  };
}
