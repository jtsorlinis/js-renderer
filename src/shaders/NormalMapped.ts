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
const specStr = 0.2;
const ambient = 0.1;

export class NormalMappedShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector4>();
  vModelPos = this.varying<Vector3>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;

    const lightSpacePos = this.uniforms.lightSpaceMat.multiplyPoint(
      model.vertices[i]
    );

    // Scale from [-1, 1] to [0, 1]
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    // Pass varyings to fragment shader
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vModelPos, model.vertices[i]);

    return this.uniforms.mvp.multiplyPoint(model.vertices[i]);
  };

  fragment = () => {
    // Get interpolated values
    const modelPos = this.interpolateVec3(this.vModelPos);
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec4(this.vLightSpacePos);

    // Calculate shadow
    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    // Sample texture
    const colour = this.sample(this.uniforms.texture, uv);
    const normal = this.sampleNormal(this.uniforms.normalTexture, uv);

    // Calculate lighting
    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const reflectDir = this.uniforms.mLightDir.reflect(normal);
    const spec = Math.pow(Math.max(viewDir.dot(reflectDir), 0), 32) * specStr;

    let diffuse = Math.max(-normal.dot(this.uniforms.mLightDir), 0);
    diffuse *= shadow;

    const lighting = this.uniforms.lightCol.scale(diffuse + spec + ambient);

    return colour.multiplyInPlace(lighting);
  };
}
