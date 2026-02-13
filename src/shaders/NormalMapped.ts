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
  // Uniforms
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector4>();
  vLightDirTangent = this.varying<Vector3>();
  vViewDirTangent = this.varying<Vector3>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];
    const bitangent = model.bitangents[i];

    // Calculate light direction and view direction in tangent space
    const modelPos = model.vertices[i];
    const lightDirTangent = new Vector3(
      tangent.dot(this.uniforms.mLightDir),
      bitangent.dot(this.uniforms.mLightDir),
      normal.dot(this.uniforms.mLightDir),
    );

    // Calculate view direction in tangent space
    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const viewDirTangent = new Vector3(
      tangent.dot(viewDir),
      bitangent.dot(viewDir),
      normal.dot(viewDir),
    );

    // Calculate light space position for shadow mapping
    const lightSpacePos = this.uniforms.lightSpaceMat.multiplyPoint(modelPos);

    // Scale from [-1, 1] to [0, 1]
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    // Pass varyings to fragment shader
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);

    // Return clip space position
    return this.uniforms.mvp.multiplyPoint(modelPos);
  };

  fragment = () => {
    // Get interpolated values
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec4(this.vLightSpacePos);
    const lightDir = this.interpolateVec3(this.vLightDirTangent).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();

    // Calculate shadow
    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    // Sample texture
    const colour = this.sample(this.uniforms.texture, uv);
    const normal = this.sample(this.uniforms.normalTexture, uv);

    // Calculate lighting
    const halfWayDir = viewDir.subtract(lightDir).normalize();
    let spec = Math.pow(Math.max(normal.dot(halfWayDir), 0), shininess);
    spec *= specStr;
    let diffuse = Math.max(-normal.dot(lightDir), 0);
    const combined = (diffuse + spec) * shadow + ambient;
    const lighting = this.uniforms.lightCol.scale(combined);

    // Return final color
    return colour.multiplyInPlace(lighting);
  };
}
