import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { Texture } from "../drawing";

export interface Uniforms {
  model: Verts;
  modelMat: Matrix4;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  camPos: Vector3;
  texture: Texture;
}

const specStr = 0.25;
const shininess = 16;
const ambient = 0.1;
export class TexturedShader extends BaseShader {
  // Uniforms are set once per draw call.
  uniforms!: Uniforms;

  // Varyings are interpolated per pixel in fragment().
  vNormal = this.varying<Vector3>();
  vWorldPos = this.varying<Vector4>();
  vUV = this.varying<Vector2>();

  vertex = (): Vector4 => {
    // Load source vertex data.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const worldPos = this.uniforms.modelMat.multiplyPoint(model.vertices[i]);
    const normal = this.uniforms.normalMat
      .multiplyDirection(model.normals[i])
      .normalize();

    // Emit per-vertex values to be interpolated over the triangle.
    this.v2f(this.vNormal, normal);
    this.v2f(this.vWorldPos, worldPos);
    this.v2f(this.vUV, model.uvs[i]);

    // Return clip-space position.
    return this.uniforms.mvp.multiplyPoint(model.vertices[i]);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const normal = this.interpolateVec3(this.vNormal).normalize();
    const worldPos = this.interpolateVec4(this.vWorldPos);
    const uv = this.interpolateVec2(this.vUV);

    // Sample albedo texture.
    const col = this.sample(this.uniforms.texture, uv);

    // Basic Blinn-Phong lighting in world space.
    const viewDir = this.uniforms.camPos.subtract(worldPos.xyz).normalize();
    const halfWayDir = viewDir.subtract(this.uniforms.lightDir).normalize();

    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;

    const diffuse = Math.max(-normal.dot(this.uniforms.lightDir), 0);

    const lighting = this.uniforms.lightCol.scale(diffuse + spec + ambient);

    return col.multiplyInPlace(lighting);
  };
}
