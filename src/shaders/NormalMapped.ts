import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  normalMat: Matrix4;
  lightDir: Vector3;
  mLightDir: Vector3;
  lightCol: Vector3;
  texture: Texture;
  normalTexture: Texture;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

export class NormalMappedShader extends BaseShader {
  // Uniforms
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector4>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const pos = this.uniforms.mvp.multiplyPoint(model.vertices[i]);

    const lightSpacePos = this.uniforms.lightSpaceMat.multiplyPoint(
      model.vertices[i]
    );

    // Pass varyings to fragment shader
    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);

    return pos;
  };

  fragment = () => {
    // Get interpolated values
    const uv = this.interpolateVec2Persp(this.vUV);
    const lightSpacePos = this.interpolateVec4Persp(this.vLightSpacePos);

    // Calculate shadow
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;
    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const bias = 0.0001;
    const shadow = lightSpacePos.z - bias > depth ? 0 : 1;

    // Sample texture
    const col = this.sample(this.uniforms.texture, uv);
    const norm = this.sampleNormal(this.uniforms.normalTexture, uv);

    // Calculate lighting
    let intensity = -norm.dot(this.uniforms.mLightDir);
    intensity *= shadow;
    const lighting = this.uniforms.lightCol.scale(intensity);

    return col.multiplyInPlace(lighting);
  };
}
