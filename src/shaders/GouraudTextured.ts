import { BaseShader } from "./BaseShader";
import { Vector3, Matrix4, Vector2 } from "../maths";
import { Material } from "../materials/Material";
import { Mesh } from "../utils/mesh";

export interface Uniforms {
  model: Mesh;
  modelMat: Matrix4;
  mvp: Matrix4;
  normalMat: Matrix4;
  worldLightDir: Vector3;
  worldCamPos: Vector3;
  material: Material;
}

const specularStrength = 0.5;
const shininess = 32;
const ambient = 0.1;

export class GouraudTexturedShader extends BaseShader<Uniforms> {
  vLighting = this.varying<number>();
  vUv = this.varying<Vector2>();

  vertex = () => {
    const model = this.uniforms.model;
    const i = this.vertexId;

    const worldPos = this.uniforms.modelMat.transformPoint(model.vertices[i]);
    const worldNormal = this.uniforms.normalMat.transformDirection(model.normals[i]).normalize();

    const worldViewDir = this.uniforms.worldCamPos.subtract(worldPos).normalize();
    const halfwayDir = worldViewDir.add(this.uniforms.worldLightDir).normalize();
    let spec = Math.pow(Math.max(worldNormal.dot(halfwayDir), 0), shininess);
    spec *= specularStrength;
    const diffuse = Math.max(worldNormal.dot(this.uniforms.worldLightDir), 0);
    const lighting = diffuse + spec + ambient;

    this.v2f(this.vLighting, lighting);
    this.v2f(this.vUv, model.uvs[i]);

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[i]);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUv);
    const baseColor = this.sample(this.uniforms.material.colorTexture, uv);
    const lighting = this.interpolateFloat(this.vLighting);
    return baseColor.scale(lighting);
  };
}
