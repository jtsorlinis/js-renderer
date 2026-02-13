import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";

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
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

const shadowBias = 0.0001;
const specStr = 0.25;
const shininess = 16;
const ambient = 0.1;

export class NormalMappedShader extends BaseShader {
  // Uniforms are set per draw call from `main.ts`.
  uniforms!: Uniforms;

  // Per-vertex data passed from vertex -> fragment.
  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector4>();
  vLightDirTangent = this.varying<Vector3>();
  vViewDirTangent = this.varying<Vector3>();

  vertex = (): Vector4 => {
    // Read the source vertex attributes from the active mesh.
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];
    const bitangent = model.bitangents[i];

    // Build lighting vectors in tangent space so sampled normal map values
    // can be dotted directly in fragment().
    const modelPos = model.vertices[i];
    const lightDirTangent = new Vector3(
      tangent.dot(this.uniforms.mLightDir),
      bitangent.dot(this.uniforms.mLightDir),
      normal.dot(this.uniforms.mLightDir),
    );

    // Same conversion for view direction.
    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const viewDirTangent = new Vector3(
      tangent.dot(viewDir),
      bitangent.dot(viewDir),
      normal.dot(viewDir),
    );

    // Position in light clip space for shadow map lookup in fragment().
    const lightSpacePos = this.uniforms.lightSpaceMat.multiplyPoint(modelPos);

    // Convert from NDC [-1, 1] to texture UV space [0, 1].
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    // Emit varyings for interpolation across the triangle.
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);

    // Final clip-space position for rasterization.
    return this.uniforms.mvp.multiplyPoint(modelPos);
  };

  fragment = () => {
    // Read interpolated values at this pixel.
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec4(this.vLightSpacePos);
    const lightDir = this.interpolateVec3(this.vLightDirTangent).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();

    // Manual depth-compare shadowing.
    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    // Sample material inputs.
    const colour = this.sample(this.uniforms.texture, uv);
    const normal = this.sample(this.uniforms.normalTexture, uv);

    // Blinn-Phong shading in tangent space.
    const halfWayDir = viewDir.subtract(lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    const diffuse = Math.max(-normal.dot(lightDir), 0);
    const lighting = this.uniforms.lightCol.scale(
      (diffuse + spec) * shadow + ambient,
    );

    // Final lit color.
    return colour.multiplyInPlace(lighting);
  };
}
