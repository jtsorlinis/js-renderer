import { BaseShader, Verts } from "./BaseShader";
import { Vector3, Matrix4, Vector4, Vector2 } from "../maths";
import { DepthTexture, Texture } from "../drawing";
import { type PbrMaterial } from "../utils/modelLoader";
import {
  DIELECTRIC_F0,
  EPSILON,
  INV_PI,
  distributionGGX,
  geometrySmith,
  saturate,
} from "./pbrHelpers";

export interface Uniforms {
  model: Verts;
  mvp: Matrix4;
  lightCol: Vector3;
  mLightDir: Vector3;
  mCamPos: Vector3;
  texture: Texture;
  normalTexture: Texture;
  pbrMaterial: PbrMaterial;
  lightSpaceMat: Matrix4;
  shadowMap: DepthTexture;
}

const shadowBias = 0.01;
const lightIntensity = 3.14;
const exposure = 1;

const ambientIntensity = 0.1;

// Direct-light PBR stage shown before the renderer adds image-based lighting.
export class PbrShader extends BaseShader {
  uniforms!: Uniforms;

  vUV = this.varying<Vector2>();
  vLightSpacePos = this.varying<Vector3>();
  vLightDirTangent = this.varying<Vector3>();
  vViewDirTangent = this.varying<Vector3>();

  vertex = (): Vector4 => {
    const model = this.uniforms.model;
    const i = this.vertexId;
    const normal = model.normals[i];
    const tangent = model.tangents[i];

    // Scalarised version of the following for performance:
    // bitangent = normal.cross(tangent).normalize().scaleInPlace(tangent.w);
    const Bx = normal.y * tangent.z - normal.z * tangent.y;
    const By = normal.z * tangent.x - normal.x * tangent.z;
    const Bz = normal.x * tangent.y - normal.y * tangent.x;
    const BLengthSq = Bx * Bx + By * By + Bz * Bz;
    const BScale = BLengthSq > 1e-8 ? tangent.w / Math.sqrt(BLengthSq) : 0;
    const bitangent = new Vector3(Bx * BScale, By * BScale, Bz * BScale);

    const modelPos = model.vertices[i];
    const lightDirTangent = new Vector3(
      tangent.dot3(this.uniforms.mLightDir),
      bitangent.dot(this.uniforms.mLightDir),
      normal.dot(this.uniforms.mLightDir),
    );

    const viewDir = this.uniforms.mCamPos.subtract(modelPos).normalize();
    const viewDirTangent = new Vector3(
      tangent.dot3(viewDir),
      bitangent.dot(viewDir),
      normal.dot(viewDir),
    );

    const lightSpacePos = this.uniforms.lightSpaceMat.transformPoint(modelPos);
    lightSpacePos.x = lightSpacePos.x * 0.5 + 0.5;
    lightSpacePos.y = lightSpacePos.y * 0.5 + 0.5;

    this.v2f(this.vUV, model.uvs[i]);
    this.v2f(this.vLightSpacePos, lightSpacePos);
    this.v2f(this.vLightDirTangent, lightDirTangent);
    this.v2f(this.vViewDirTangent, viewDirTangent);

    return this.uniforms.mvp.transformPoint4(modelPos);
  };

  fragment = () => {
    const uv = this.interpolateVec2(this.vUV);
    const lightSpacePos = this.interpolateVec3(this.vLightSpacePos);
    const lightDirTangent = this.interpolateVec3(
      this.vLightDirTangent,
    ).normalize();
    const viewDir = this.interpolateVec3(this.vViewDirTangent).normalize();

    const depth = this.sampleDepth(this.uniforms.shadowMap, lightSpacePos);
    const shadow = lightSpacePos.z - shadowBias > depth ? 0 : 1;

    const normal = this.sample(this.uniforms.normalTexture, uv);
    const baseColor = this.sample(this.uniforms.texture, uv).multiplyInPlace(
      this.uniforms.pbrMaterial.baseColorFactor,
    );
    const metallicRoughness = this.sample(
      this.uniforms.pbrMaterial.metallicRoughnessTexture,
      uv,
    );
    const roughness = Math.max(
      0.045,
      saturate(metallicRoughness.y * this.uniforms.pbrMaterial.roughnessFactor),
    );
    const metallic = saturate(
      metallicRoughness.z * this.uniforms.pbrMaterial.metallicFactor,
    );
    const f0x = DIELECTRIC_F0.x + (baseColor.x - DIELECTRIC_F0.x) * metallic;
    const f0y = DIELECTRIC_F0.y + (baseColor.y - DIELECTRIC_F0.y) * metallic;
    const f0z = DIELECTRIC_F0.z + (baseColor.z - DIELECTRIC_F0.z) * metallic;

    const lightDir = lightDirTangent.scaleInPlace(-1);
    const nDotL = saturate(normal.dot(lightDir));
    const nDotV = saturate(normal.dot(viewDir));
    const halfDir = lightDir.addInPlace(viewDir);

    let directR = 0;
    let directG = 0;
    let directB = 0;
    if (nDotL > 0 && nDotV > 0 && halfDir.lengthSq() > EPSILON) {
      halfDir.normalize();
      const nDotH = saturate(normal.dot(halfDir));
      const vDotH = saturate(viewDir.dot(halfDir));
      const fresnelFactor = Math.pow(1 - saturate(vDotH), 5);
      const fresnelX = f0x + (1 - f0x) * fresnelFactor;
      const fresnelY = f0y + (1 - f0y) * fresnelFactor;
      const fresnelZ = f0z + (1 - f0z) * fresnelFactor;
      const distribution = distributionGGX(nDotH, roughness);
      const geometry = geometrySmith(nDotV, nDotL, roughness);
      const specularFactor =
        (distribution * geometry) / Math.max(4 * nDotV * nDotL, EPSILON);
      const diffuseFactor = (1 - metallic) * INV_PI;
      const lightScale = nDotL * shadow * lightIntensity;

      directR =
        ((1 - fresnelX) * diffuseFactor * baseColor.x +
          fresnelX * specularFactor) *
        this.uniforms.lightCol.x *
        lightScale;
      directG =
        ((1 - fresnelY) * diffuseFactor * baseColor.y +
          fresnelY * specularFactor) *
        this.uniforms.lightCol.y *
        lightScale;
      directB =
        ((1 - fresnelZ) * diffuseFactor * baseColor.z +
          fresnelZ * specularFactor) *
        this.uniforms.lightCol.z *
        lightScale;
    }

    // Keep the direct-light PBR step readable with a tiny material-aware fill
    const ambientR = (baseColor.x * (1 - metallic) + f0x) * ambientIntensity;
    const ambientG = (baseColor.y * (1 - metallic) + f0y) * ambientIntensity;
    const ambientB = (baseColor.z * (1 - metallic) + f0z) * ambientIntensity;

    return new Vector3(
      (ambientR + directR) * exposure,
      (ambientG + directG) * exposure,
      (ambientB + directB) * exposure,
    );
  };
}
