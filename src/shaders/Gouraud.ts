import { Vector3, Matrix4 } from "../maths";
import type { Mesh } from "../utils/mesh";
import { BaseShader } from "./BaseShader";

export interface Uniforms {
  model: Mesh;
  modelMat: Matrix4;
  mvp: Matrix4;
  normalMat: Matrix4;
  worldLightDir: Vector3;
  worldCamPos: Vector3;
  orthographic: boolean;
  worldViewDir: Vector3;
}

const specularStrength = 0.5;
const shininess = 32;
const ambient = 0.1;
const baseColor = new Vector3(0.5, 0.5, 0.5);

export class GouraudShader extends BaseShader<Uniforms> {
  vertexColor = this.varying<Vector3>();

  vertex = () => {
    const model = this.uniforms.model;
    const i = this.vertexId;

    const worldPos = this.uniforms.modelMat.transformPoint(model.vertices[i]);
    const worldNormal = this.uniforms.normalMat.transformDirection(model.normals[i]).normalize();

    const worldViewDir = this.uniforms.orthographic
      ? this.uniforms.worldViewDir
      : this.uniforms.worldCamPos.subtract(worldPos).normalize();
    const halfwayDir = worldViewDir.add(this.uniforms.worldLightDir).normalize();
    let spec = Math.pow(Math.max(worldNormal.dot(halfwayDir), 0), shininess);
    spec *= specularStrength;
    const diffuse = Math.max(worldNormal.dot(this.uniforms.worldLightDir), 0);
    const vertColor = baseColor.scale(diffuse + ambient).addScalarInPlace(spec);
    this.v2f(this.vertexColor, vertColor);

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[i]);
  };

  fragment = () => {
    return this.interpolateVec3(this.vertexColor);
  };
}
