import { BaseShader } from "./BaseShader";
import { Vector3, Matrix4, Vector2, Vector4 } from "../maths";
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
  disableTexture?: boolean;
  useSpecular?: boolean;
}

const specularStrength = 0.25;
const shininess = 32;
const ambient = 0.1;

export class GouraudShader extends BaseShader<Uniforms> {
  vColorSpec = this.varying<Vector4>();
  vUv = this.varying<Vector2>();

  vertex = () => {
    const model = this.uniforms.model;
    const i = this.vertexId;

    const worldNormal = this.uniforms.normalMat.transformDirection(model.normals[i]).normalize();

    let spec = 0;
    if (this.uniforms.useSpecular) {
      const worldPos = this.uniforms.modelMat.transformPoint(model.vertices[i]);
      const worldViewDir = this.uniforms.worldCamPos.subtract(worldPos).normalize();
      const halfwayDir = worldViewDir.add(this.uniforms.worldLightDir).normalize();
      spec = Math.pow(Math.max(worldNormal.dot(halfwayDir), 0), shininess);
      spec *= specularStrength;
    }

    const diffuse = Math.max(worldNormal.dot(this.uniforms.worldLightDir), 0);
    const vertexColour = Vector3.One.scaleInPlace(diffuse + ambient);
    const colorSpecular = new Vector4(vertexColour.x, vertexColour.y, vertexColour.z, spec);

    this.v2f(this.vColorSpec, colorSpecular);
    if (!this.uniforms.disableTexture) {
      this.v2f(this.vUv, model.uvs[i]);
    }

    // Return clip-space position.
    return this.uniforms.mvp.transformPoint4(model.vertices[i]);
  };

  fragment = () => {
    let baseColor = new Vector3(0.75, 0.75, 0.75);
    if (!this.uniforms.disableTexture) {
      const uv = this.interpolateVec2(this.vUv);
      baseColor = this.sample(this.uniforms.material.colorTexture, uv);
    }

    const specColour = this.interpolateVec4(this.vColorSpec);
    const spec = specColour.w;
    const color = specColour.xyz;
    return baseColor.multiplyInPlace(color).addScalar(spec);
  };
}
