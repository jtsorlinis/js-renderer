import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { Texture } from "../drawing";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  texture: Texture;
}

export class TexturedShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  // Varyings
  vNormal = this.varying<Vector3>();
  vUV = this.varying<Vector2>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const pos = this.uniforms.mvp.multiplyPoint(model.vertices[i]);
    const normal = this.uniforms.normalMat
      .multiplyDirection(model.normals[i])
      .normalize();

    // Pass varyings to fragment shader
    this.v2f(this.vNormal, normal);
    this.v2f(this.vUV, model.uvs[i]);

    return pos;
  };

  fragment = () => {
    // Get interpolated values
    const normal = this.interpolateVec3(this.vNormal).normalize();
    const uv = this.interpolateVec2Persp(this.vUV);

    // Sample texture
    const col = this.sample(this.uniforms.texture, uv);

    // Calculate lighting
    const intensity = -normal.dot(this.uniforms.lightDir);
    const lighting = this.uniforms.lightCol.scale(intensity);

    return col.multiply(lighting);
  };
}
