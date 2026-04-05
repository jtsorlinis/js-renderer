import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { Texture } from "../drawing";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  lightCol: Vector3;
  camPos: Vector3;
  mCamPos: Vector3;
  texture: Texture;
  mLightDir: Vector3;
  normalTexture: Texture;
}

const specStr = 0.5;
const shininess = 32;
const ambient = 0.05;

export class TexturedShader extends BaseShader {
  // Uniforms are set per draw call from `main.ts`.
  uniforms!: Uniforms;

  // Per-vertex data passed from vertex -> fragment.
  vUV = this.varying<Vector2>();
  vModelPos = this.varying<Vector3>();
  vNormal = this.varying<Vector3>();
  vTangent = this.varying<Vector4>();

  vertex = (): Vector4 => {
    // Read the source vertex attributes from the active mesh.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const N = model.normals[i];
    const tangent = model.tangents[i];
    const modelPos = model.vertices[i];

    // Emit varyings for interpolation across the triangle.
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vNormal, N);
    this.v2f(this.vTangent, tangent);
    this.v2f(this.vModelPos, modelPos);

    // Final clip-space position for rasterization.
    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const uv = this.interpolateVec2(this.vUV);
    const modelPos = this.interpolateVec3(this.vModelPos);
    const tangent4 = this.interpolateVec4(this.vTangent);
    const tangent = tangent4.xyz;
    const handedNess = tangent4.w < 0 ? -1 : 1;

    const N = this.interpolateVec3(this.vNormal).normalize();
    const T = tangent.subtractInPlace(N.scale(N.dot(tangent))).normalize();
    const B = N.cross(T).scaleInPlace(handedNess);

    // Sample material inputs.
    const colour = this.sample(this.uniforms.texture, uv);
    const normalTS = this.sample(this.uniforms.normalTexture, uv);

    const normal = T.scaleInPlace(normalTS.x)
      .addInPlace(B.scaleInPlace(normalTS.y))
      .addInPlace(N.scaleInPlace(normalTS.z))
      .normalize();

    // Blinn-Phong shading
    const lightDir = this.uniforms.mLightDir;
    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const halfWayDir = viewDir.subtractInPlace(lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    const diffuse = Math.max(-normal.dot(lightDir), 0);
    const lighting = this.uniforms.lightCol.scale(diffuse + spec + ambient);

    // Final lit color.
    return colour.multiplyInPlace(lighting);
  };
}
