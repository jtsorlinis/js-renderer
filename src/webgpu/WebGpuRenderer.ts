import { Matrix4, Vector3 } from "../maths";
import type { Texture } from "../drawing";
import type { Material } from "../materials/Material";
import type { MaterialMode, RenderMode } from "../renderSettings";
import type { IblData } from "../shaders/iblHelpers";
import type { Mesh } from "../utils/mesh";

const FLOATS_PER_VERTEX = 15;
const BYTES_PER_FLOAT = 4;
const VERTEX_STRIDE = FLOATS_PER_VERTEX * BYTES_PER_FLOAT;
const SHADOW_MAP_SIZE = 2048;

const UNIFORM_MVP_OFFSET = 0;
const UNIFORM_MODEL_OFFSET = 16;
const UNIFORM_NORMAL_OFFSET = 32;
const UNIFORM_LIGHT_SPACE_OFFSET = 48;
const UNIFORM_WORLD_LIGHT_OFFSET = 64;
const UNIFORM_WORLD_CAM_OFFSET = 68;
const UNIFORM_WORLD_VIEW_OFFSET = 72;
const UNIFORM_MATERIAL_FACTORS_OFFSET = 76;
const UNIFORM_FLAGS_OFFSET = 80;
const UNIFORM_ENV_YAW_OFFSET = 84;
const UNIFORM_CAMERA_OFFSET = 88;
const UNIFORM_FLOAT_COUNT = 92;

const GPU_BUFFER_USAGE = {
  COPY_DST: 0x0008,
  VERTEX: 0x0020,
  UNIFORM: 0x0040,
  STORAGE: 0x0080,
} as const;

const GPU_TEXTURE_USAGE = {
  COPY_DST: 0x02,
  TEXTURE_BINDING: 0x04,
  RENDER_ATTACHMENT: 0x10,
} as const;

const GPU_SHADER_STAGE = {
  VERTEX: 0x1,
  FRAGMENT: 0x2,
} as const;

const MODE_BY_MATERIAL: Record<MaterialMode, number> = {
  depth: 0,
  unlit: 1,
  flat: 2,
  smooth: 3,
  textured: 4,
  normalMapped: 5,
  pbr: 6,
  ibl: 7,
};

export type WebGpuRenderParams = {
  model: Mesh;
  material: Material;
  iblData: IblData;
  materialMode: MaterialMode;
  renderMode?: RenderMode;
  mvp: Matrix4;
  modelMat: Matrix4;
  normalMat: Matrix4;
  worldLightSpaceMat: Matrix4;
  worldLightDir: Vector3;
  worldCamPos: Vector3;
  worldViewDir: Vector3;
  envYaw: { sin: number; cos: number };
  aspectRatio: number;
  fov: number;
  orthographic: boolean;
  useShadows?: boolean;
  showEnvironmentBackground?: boolean;
  tonemap?: boolean;
};

const MAIN_SHADER = /* wgsl */ `
struct Uniforms {
  mvp: mat4x4f,
  modelMat: mat4x4f,
  normalMat: mat4x4f,
  worldLightSpaceMat: mat4x4f,
  worldLightDir: vec4f,
  worldCamPos: vec4f,
  worldViewDir: vec4f,
  materialFactors: vec4f,
  flags: vec4f,
  envYaw: vec4f,
  camera: vec4f,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) faceNormal: vec3f,
  @location(3) uv: vec2f,
  @location(4) tangent: vec4f,
};

struct VertexOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) worldPos: vec3f,
  @location(1) worldNormal: vec3f,
  @location(2) faceNormal: vec3f,
  @location(3) uv: vec2f,
  @location(4) worldTangent: vec4f,
  @location(5) worldLightSpacePos: vec4f,
  @location(6) faceColor: vec3f,
};

struct BackgroundOutput {
  @builtin(position) clipPosition: vec4f,
  @location(0) ndc: vec2f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var colorTexture: texture_2d<f32>;
@group(0) @binding(2) var normalTexture: texture_2d<f32>;
@group(0) @binding(3) var ormTexture: texture_2d<f32>;
@group(0) @binding(4) var materialSampler: sampler;
@group(0) @binding(5) var shadowTexture: texture_depth_2d;
@group(0) @binding(6) var shadowSampler: sampler_comparison;
@group(0) @binding(7) var<storage, read> diffuseIrradianceMap: array<f32>;
@group(0) @binding(8) var<storage, read> specularPrefilterMap: array<f32>;
@group(0) @binding(9) var<storage, read> specularBrdfLut: array<f32>;

const MODE_DEPTH = 0;
const MODE_UNLIT = 1;
const MODE_FLAT = 2;
const MODE_SMOOTH = 3;
const MODE_TEXTURED = 4;
const MODE_NORMAL_MAPPED = 5;
const MODE_PBR = 6;
const MODE_IBL = 7;
const EPSILON = 0.00001;
const INV_PI = 0.31830988618;
const INV_TAU = 0.15915494309;
const INV_21 = 0.04761904762;
const DIFFUSE_MAP_WIDTH = 32.0;
const DIFFUSE_MAP_HEIGHT = 16.0;
const SPECULAR_MAP_WIDTH = 64.0;
const SPECULAR_MAP_HEIGHT = 32.0;
const SPECULAR_LAYER_STRIDE = 6144u;
const SPECULAR_ROUGHNESS_MAX_INDEX = 31.0;
const SPECULAR_BRDF_LUT_SIZE = 128u;
const SPECULAR_BRDF_LUT_MAX_INDEX = 127.0;

fn saturate(value: f32) -> f32 {
  return clamp(value, 0.0, 1.0);
}

fn hash(seed: u32) -> f32 {
  var x = seed;
  x = x ^ (x >> 16u);
  x = x * 0x7feb352du;
  x = x ^ (x >> 15u);
  x = x * 0x846ca68bu;
  x = x ^ (x >> 16u);
  return f32(x) / 4294967295.0;
}

fn hash3(seed: u32, minimum: f32, maximum: f32) -> vec3f {
  let scale = maximum - minimum;
  return vec3f(
    minimum + hash(seed) * scale,
    minimum + hash(seed + 1u) * scale,
    minimum + hash(seed + 2u) * scale
  );
}

fn linear_to_srgb(color: vec3f) -> vec3f {
  let clamped = clamp(color, vec3f(0.0), vec3f(1.0));
  let lower = clamped * 12.92;
  let upper = 1.055 * pow(clamped, vec3f(1.0 / 2.4)) - vec3f(0.055);
  return select(upper, lower, clamped <= vec3f(0.0031308));
}

fn tonemap_neutral(inputColor: vec3f) -> vec3f {
  var color = max(inputColor, vec3f(0.0));
  let startCompression = 0.76;
  let desaturation = 0.15;
  let x = min(color.x, min(color.y, color.z));
  var offset = 0.04;
  if (x < 0.08) {
    offset = x - 6.25 * x * x;
  }
  color = color - vec3f(offset);

  let peak = max(color.x, max(color.y, color.z));
  if (peak < startCompression) {
    return color;
  }

  let d = 1.0 - startCompression;
  let newPeak = 1.0 - (d * d) / (peak + d - startCompression);
  color = color * (newPeak / peak);

  let g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return color * (1.0 - g) + vec3f(g * newPeak);
}

fn output_color(linearColor: vec3f) -> vec4f {
  var color = linearColor;
  if (uniforms.flags.z > 0.5) {
    color = tonemap_neutral(color);
  }
  return vec4f(linear_to_srgb(color), 1.0);
}

fn distribution_ggx(nDotH: f32, roughness: f32) -> f32 {
  let alpha = roughness * roughness;
  let alphaSq = alpha * alpha;
  let denom = nDotH * nDotH * (alphaSq - 1.0) + 1.0;
  return alphaSq / max(3.14159265359 * denom * denom, EPSILON);
}

fn geometry_schlick_ggx(nDotX: f32, roughness: f32) -> f32 {
  let r = roughness + 1.0;
  let k = (r * r) / 8.0;
  return nDotX / max(nDotX * (1.0 - k) + k, EPSILON);
}

fn geometry_smith(nDotV: f32, nDotL: f32, roughness: f32) -> f32 {
  return geometry_schlick_ggx(nDotV, roughness) * geometry_schlick_ggx(nDotL, roughness);
}

fn get_view_dir(worldPos: vec3f) -> vec3f {
  if (uniforms.flags.y > 0.5) {
    return normalize(uniforms.worldViewDir.xyz);
  }
  return normalize(uniforms.worldCamPos.xyz - worldPos);
}

fn material_uv(uv: vec2f) -> vec2f {
  return vec2f(uv.x, 1.0 - uv.y);
}

fn wrap_unit(value: f32) -> f32 {
  return value - floor(value);
}

fn sample_diffuse_irradiance(u: f32, v: f32) -> vec3f {
  let xCoord = wrap_unit(u) * DIFFUSE_MAP_WIDTH - 0.5;
  let yCoord = clamp(v * DIFFUSE_MAP_HEIGHT - 0.5, 0.0, DIFFUSE_MAP_HEIGHT - 1.0);
  let x0 = floor(xCoord);
  let y0 = floor(yCoord);
  let xBlend = xCoord - x0;
  let yBlend = yCoord - y0;
  let xIndex0 = ((i32(x0) % 32) + 32) % 32;
  let xIndex1 = (xIndex0 + 1) % 32;
  let yIndex0 = clamp(i32(y0), 0, 15);
  let yIndex1 = min(yIndex0 + 1, 15);
  let base00 = u32((yIndex0 * 32 + xIndex0) * 3);
  let base10 = u32((yIndex0 * 32 + xIndex1) * 3);
  let base01 = u32((yIndex1 * 32 + xIndex0) * 3);
  let base11 = u32((yIndex1 * 32 + xIndex1) * 3);
  let c00 = vec3f(diffuseIrradianceMap[base00], diffuseIrradianceMap[base00 + 1u], diffuseIrradianceMap[base00 + 2u]);
  let c10 = vec3f(diffuseIrradianceMap[base10], diffuseIrradianceMap[base10 + 1u], diffuseIrradianceMap[base10 + 2u]);
  let c01 = vec3f(diffuseIrradianceMap[base01], diffuseIrradianceMap[base01 + 1u], diffuseIrradianceMap[base01 + 2u]);
  let c11 = vec3f(diffuseIrradianceMap[base11], diffuseIrradianceMap[base11 + 1u], diffuseIrradianceMap[base11 + 2u]);
  return mix(mix(c00, c10, vec3f(xBlend)), mix(c01, c11, vec3f(xBlend)), vec3f(yBlend));
}

fn sample_specular_prefilter(u: f32, v: f32, layerIndex: u32) -> vec3f {
  let xCoord = wrap_unit(u) * SPECULAR_MAP_WIDTH - 0.5;
  let yCoord = clamp(v * SPECULAR_MAP_HEIGHT - 0.5, 0.0, SPECULAR_MAP_HEIGHT - 1.0);
  let x0 = floor(xCoord);
  let y0 = floor(yCoord);
  let xBlend = xCoord - x0;
  let yBlend = yCoord - y0;
  let xIndex0 = ((i32(x0) % 64) + 64) % 64;
  let xIndex1 = (xIndex0 + 1) % 64;
  let yIndex0 = clamp(i32(y0), 0, 31);
  let yIndex1 = min(yIndex0 + 1, 31);
  let layerOffset = layerIndex * SPECULAR_LAYER_STRIDE;
  let base00 = layerOffset + u32((yIndex0 * 64 + xIndex0) * 3);
  let base10 = layerOffset + u32((yIndex0 * 64 + xIndex1) * 3);
  let base01 = layerOffset + u32((yIndex1 * 64 + xIndex0) * 3);
  let base11 = layerOffset + u32((yIndex1 * 64 + xIndex1) * 3);
  let c00 = vec3f(specularPrefilterMap[base00], specularPrefilterMap[base00 + 1u], specularPrefilterMap[base00 + 2u]);
  let c10 = vec3f(specularPrefilterMap[base10], specularPrefilterMap[base10 + 1u], specularPrefilterMap[base10 + 2u]);
  let c01 = vec3f(specularPrefilterMap[base01], specularPrefilterMap[base01 + 1u], specularPrefilterMap[base01 + 2u]);
  let c11 = vec3f(specularPrefilterMap[base11], specularPrefilterMap[base11 + 1u], specularPrefilterMap[base11 + 2u]);
  return mix(mix(c00, c10, vec3f(xBlend)), mix(c01, c11, vec3f(xBlend)), vec3f(yBlend));
}

fn sample_specular_brdf(nDotV: f32, roughness: f32) -> vec2f {
  let viewCoord = nDotV * SPECULAR_BRDF_LUT_MAX_INDEX;
  let viewIndex = u32(floor(viewCoord));
  let viewNext = min(viewIndex + 1u, 127u);
  let viewBlend = viewCoord - f32(viewIndex);
  let roughnessCoord = roughness * SPECULAR_BRDF_LUT_MAX_INDEX;
  let roughnessIndex = u32(floor(roughnessCoord));
  let roughnessNext = min(roughnessIndex + 1u, 127u);
  let roughnessBlend = roughnessCoord - f32(roughnessIndex);
  let base00 = (roughnessIndex * SPECULAR_BRDF_LUT_SIZE + viewIndex) * 2u;
  let base10 = (roughnessIndex * SPECULAR_BRDF_LUT_SIZE + viewNext) * 2u;
  let base01 = (roughnessNext * SPECULAR_BRDF_LUT_SIZE + viewIndex) * 2u;
  let base11 = (roughnessNext * SPECULAR_BRDF_LUT_SIZE + viewNext) * 2u;
  let brdf00 = vec2f(specularBrdfLut[base00], specularBrdfLut[base00 + 1u]);
  let brdf10 = vec2f(specularBrdfLut[base10], specularBrdfLut[base10 + 1u]);
  let brdf01 = vec2f(specularBrdfLut[base01], specularBrdfLut[base01 + 1u]);
  let brdf11 = vec2f(specularBrdfLut[base11], specularBrdfLut[base11 + 1u]);
  return mix(mix(brdf00, brdf10, vec2f(viewBlend)), mix(brdf01, brdf11, vec2f(viewBlend)), vec2f(roughnessBlend));
}

fn apply_normal_map(baseNormal: vec3f, tangentInput: vec4f, uv: vec2f) -> vec3f {
  let normalTexel = textureSample(normalTexture, materialSampler, material_uv(uv)).xyz * 2.0 - vec3f(1.0);
  let tangent = normalize(tangentInput.xyz - baseNormal * dot(tangentInput.xyz, baseNormal));
  let handedness = select(1.0, -1.0, tangentInput.w < 0.0);
  let bitangent = cross(baseNormal, tangent) * handedness;
  return normalize(tangent * normalTexel.x + bitangent * normalTexel.y + baseNormal * normalTexel.z);
}

fn shadow_factor(worldLightSpacePos: vec4f, normal: vec3f) -> f32 {
  if (uniforms.flags.w < 0.5) {
    return 1.0;
  }

  let ndc = worldLightSpacePos.xyz / worldLightSpacePos.w;
  let uv = vec2f(ndc.x * 0.5 + 0.5, 1.0 - (ndc.y * 0.5 + 0.5));
  let validProjection = uv.x >= 0.0 && uv.x <= 1.0 && uv.y >= 0.0 && uv.y <= 1.0 && ndc.z >= 0.0 && ndc.z <= 1.0;
  let nDotL = saturate(dot(normal, uniforms.worldLightDir.xyz));
  let bias = 0.001 + (0.005 - 0.001) * (1.0 - nDotL);
  let shadow = textureSampleCompare(shadowTexture, shadowSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), ndc.z - bias);
  return select(1.0, shadow, validProjection);
}

fn blinn_phong(baseColor: vec3f, normal: vec3f, viewDir: vec3f, shadow: f32) -> vec3f {
  let lightDir = normalize(uniforms.worldLightDir.xyz);
  let halfwayDir = normalize(viewDir + lightDir);
  let specular = pow(max(dot(normal, halfwayDir), 0.0), 32.0) * 0.25 * shadow;
  let diffuse = max(dot(normal, lightDir), 0.0) * shadow;
  return baseColor * (diffuse + 0.1) + vec3f(specular);
}

fn ibl_ambient(
  baseColor: vec3f,
  normal: vec3f,
  viewDir: vec3f,
  rawNDotV: f32,
  nDotV: f32,
  roughness: f32,
  metallic: f32,
  f0: vec3f,
  ambientOcclusion: f32,
) -> vec3f {
  let ambientDiffuseFactor = 1.0 - metallic;
  let diffuseDirX = normal.x * uniforms.envYaw.y - normal.z * uniforms.envYaw.x;
  let diffuseDirZ = normal.x * uniforms.envYaw.x + normal.z * uniforms.envYaw.y;
  let diffuseU = wrap_unit(atan2(diffuseDirX, diffuseDirZ) * INV_TAU + 0.5);
  let diffuseV = acos(clamp(normal.y, -1.0, 1.0)) * INV_PI;
  let diffuseEnv = sample_diffuse_irradiance(diffuseU, diffuseV);

  let reflectionScale = 2.0 * rawNDotV;
  let reflectionX = normal.x * reflectionScale - viewDir.x;
  let reflectionY = normal.y * reflectionScale - viewDir.y;
  let reflectionZ = normal.z * reflectionScale - viewDir.z;
  let rotatedReflectionX = reflectionX * uniforms.envYaw.y - reflectionZ * uniforms.envYaw.x;
  let rotatedReflectionZ = reflectionX * uniforms.envYaw.x + reflectionZ * uniforms.envYaw.y;
  let reflectionU = wrap_unit(atan2(rotatedReflectionX, rotatedReflectionZ) * INV_TAU + 0.5);
  let reflectionV = acos(clamp(reflectionY, -1.0, 1.0)) * INV_PI;
  let roughnessLayer = u32(min(SPECULAR_ROUGHNESS_MAX_INDEX, round(roughness * SPECULAR_ROUGHNESS_MAX_INDEX)));
  let specularEnv = sample_specular_prefilter(reflectionU, reflectionV, roughnessLayer);

  let envBrdf = sample_specular_brdf(nDotV, roughness);
  let ambientFresnelBase = 1.0 - nDotV;
  let ambientFresnelBaseSq = ambientFresnelBase * ambientFresnelBase;
  let ambientFresnelFactor = ambientFresnelBaseSq * ambientFresnelBaseSq * ambientFresnelBase;
  let fr = max(vec3f(1.0 - roughness), f0) - f0;
  let ks = f0 + fr * ambientFresnelFactor;
  let fssEss = ks * envBrdf.x + vec3f(envBrdf.y);
  let ems = max(0.0, 1.0 - (envBrdf.x + envBrdf.y));
  let favg = f0 + (vec3f(1.0) - f0) * INV_21;
  let fmsEms = ((fssEss * favg) / max(vec3f(1.0) - ems * favg, vec3f(EPSILON))) * ems;
  let specularWeight = fssEss + fmsEms;
  let diffuseWeight = max(vec3f(0.0), vec3f(1.0) - specularWeight);

  return (
    diffuseWeight * baseColor * diffuseEnv * ambientDiffuseFactor +
    specularWeight * specularEnv
  ) * ambientOcclusion;
}

fn environment_color_from_dir(direction: vec3f, roughness: f32, yawOffset: f32) -> vec3f {
  let rotatedX = direction.x * uniforms.envYaw.y - direction.z * uniforms.envYaw.x;
  let rotatedZ = direction.x * uniforms.envYaw.x + direction.z * uniforms.envYaw.y;
  let u = wrap_unit(atan2(rotatedX, rotatedZ) * INV_TAU + yawOffset);
  let v = acos(clamp(direction.y, -1.0, 1.0)) * INV_PI;
  let roughnessLayer = u32(min(SPECULAR_ROUGHNESS_MAX_INDEX, round(roughness * SPECULAR_ROUGHNESS_MAX_INDEX)));
  return sample_specular_prefilter(u, v, roughnessLayer);
}

fn pbr_lighting(baseColor: vec3f, normal: vec3f, viewDir: vec3f, shadow: f32, mode: i32, uv: vec2f) -> vec3f {
  let orm = textureSample(ormTexture, materialSampler, material_uv(uv)).xyz;
  let ambientOcclusion = 1.0 - uniforms.materialFactors.x + uniforms.materialFactors.x * orm.x;
  let roughness = max(0.045, saturate(orm.y * uniforms.materialFactors.y));
  let metallic = saturate(orm.z * uniforms.materialFactors.z);
  let f0 = mix(vec3f(0.04), baseColor, vec3f(metallic));
  let lightDir = normalize(uniforms.worldLightDir.xyz);
  let nDotL = saturate(dot(normal, lightDir));
  let rawNDotV = dot(normal, viewDir);
  let nDotV = saturate(rawNDotV);

  var direct = vec3f(0.0);
  if (nDotL > 0.0 && nDotV > 0.0 && shadow > 0.0) {
    let halfDir = normalize(viewDir + lightDir);
    let nDotH = saturate(dot(normal, halfDir));
    let vDotH = saturate(dot(viewDir, halfDir));
    let fresnel = f0 + (vec3f(1.0) - f0) * pow(1.0 - vDotH, 5.0);
    let distribution = distribution_ggx(nDotH, roughness);
    let geometry = geometry_smith(nDotV, nDotL, roughness);
    let specularFactor = (distribution * geometry) / max(4.0 * nDotV * nDotL, EPSILON);
    let diffuseFactor = (vec3f(1.0) - fresnel) * (1.0 - metallic) * INV_PI;
    let lightIntensity = select(3.14, 2.0, mode == MODE_IBL);
    direct = (diffuseFactor * baseColor + fresnel * specularFactor) * nDotL * lightIntensity * shadow;
  }

  if (mode == MODE_IBL) {
    return ibl_ambient(
      baseColor,
      normal,
      viewDir,
      rawNDotV,
      nDotV,
      roughness,
      metallic,
      f0,
      ambientOcclusion
    ) + direct;
  }

  let ambient = (baseColor * (1.0 - metallic) + f0) * 0.1 * ambientOcclusion;
  return ambient + direct;
}

@vertex
fn vertex_main(input: VertexInput, @builtin(vertex_index) vertexIndex: u32) -> VertexOutput {
  let modelPosition = vec4f(input.position, 1.0);
  let worldPosition = uniforms.modelMat * modelPosition;
  var output: VertexOutput;
  output.clipPosition = uniforms.mvp * modelPosition;
  output.worldPos = worldPosition.xyz;
  output.worldNormal = normalize((uniforms.normalMat * vec4f(input.normal, 0.0)).xyz);
  output.faceNormal = normalize((uniforms.normalMat * vec4f(input.faceNormal, 0.0)).xyz);
  output.uv = input.uv;
  output.worldTangent = vec4f(normalize((uniforms.modelMat * vec4f(input.tangent.xyz, 0.0)).xyz), input.tangent.w);
  output.worldLightSpacePos = uniforms.worldLightSpaceMat * uniforms.modelMat * modelPosition;
  output.faceColor = hash3((vertexIndex / 3u) * 3u, 0.25, 1.0);
  return output;
}

@fragment
fn fragment_main(input: VertexOutput) -> @location(0) vec4f {
  let mode = i32(uniforms.flags.x + 0.5);
  if (mode == MODE_DEPTH) {
    return output_color(vec3f(input.clipPosition.z));
  }

  if (mode == MODE_UNLIT) {
    return output_color(input.faceColor);
  }

  let viewDir = get_view_dir(input.worldPos);
  var normal = normalize(input.worldNormal);
  var baseColor = vec3f(0.5);

  if (mode == MODE_FLAT) {
    normal = normalize(input.faceNormal);
  }

  if (mode >= MODE_TEXTURED) {
    baseColor = textureSample(colorTexture, materialSampler, material_uv(input.uv)).xyz;
  }

  if (mode >= MODE_NORMAL_MAPPED) {
    normal = apply_normal_map(normal, input.worldTangent, input.uv);
  }

  let shadow = shadow_factor(input.worldLightSpacePos, normal);
  if (mode >= MODE_PBR) {
    return output_color(pbr_lighting(baseColor, normal, viewDir, shadow, mode, input.uv));
  }

  return output_color(blinn_phong(baseColor, normal, viewDir, shadow));
}

@vertex
fn background_vertex_main(@builtin(vertex_index) vertexIndex: u32) -> BackgroundOutput {
  let positions = array<vec2f, 3>(
    vec2f(-1.0, -3.0),
    vec2f(3.0, 1.0),
    vec2f(-1.0, 1.0)
  );
  let position = positions[vertexIndex];
  var output: BackgroundOutput;
  output.clipPosition = vec4f(position, 0.0, 1.0);
  output.ndc = position;
  return output;
}

@fragment
fn background_fragment_main(input: BackgroundOutput) -> @location(0) vec4f {
  let viewDir = normalize(vec3f(
    input.ndc.x * uniforms.camera.x * uniforms.camera.y,
    input.ndc.y * uniforms.camera.y,
    1.0
  ));
  return output_color(environment_color_from_dir(viewDir, 0.5, 1.5));
}
`;

const SHADOW_SHADER = /* wgsl */ `
struct Uniforms {
  mvp: mat4x4f,
  modelMat: mat4x4f,
  normalMat: mat4x4f,
  worldLightSpaceMat: mat4x4f,
};

struct VertexInput {
  @location(0) position: vec3f,
  @location(1) normal: vec3f,
  @location(2) faceNormal: vec3f,
  @location(3) uv: vec2f,
  @location(4) tangent: vec4f,
};

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertex_main(input: VertexInput) -> @builtin(position) vec4f {
  return uniforms.worldLightSpaceMat * uniforms.modelMat * vec4f(input.position, 1.0);
}
`;

const toUnorm8 = (value: number) => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.round(Math.max(0, Math.min(1, value)) * 255);
};

const vectorToUniform = (data: Float32Array, offset: number, value: Vector3, w = 0) => {
  data[offset] = value.x;
  data[offset + 1] = value.y;
  data[offset + 2] = value.z;
  data[offset + 3] = w;
};

export class WebGpuRenderer {
  private readonly device: GPUDevice;
  private readonly context: GPUCanvasContext;
  private readonly format: GPUTextureFormat;
  private readonly uniformBuffer: GPUBuffer;
  private readonly uniformData = new Float32Array(UNIFORM_FLOAT_COUNT);
  private readonly mainPipeline: GPURenderPipeline;
  private readonly backgroundPipeline: GPURenderPipeline;
  private readonly shadowPipeline: GPURenderPipeline;
  private readonly mainBindGroupLayout: GPUBindGroupLayout;
  private readonly shadowBindGroup: GPUBindGroup;
  private readonly sampler: GPUSampler;
  private readonly shadowSampler: GPUSampler;
  private readonly shadowDepthTexture: GPUTexture;
  private readonly shadowDepthView: GPUTextureView;

  private depthTexture: GPUTexture;
  private depthTextureView: GPUTextureView;
  private diffuseIblBuffer?: GPUBuffer;
  private specularIblBuffer?: GPUBuffer;
  private brdfIblBuffer?: GPUBuffer;
  private vertexBuffer?: GPUBuffer;
  private vertexCount = 0;
  private uploadedMesh?: Mesh;
  private uploadedMaterial?: Material;
  private uploadedIblData?: IblData;
  private materialBindGroup?: GPUBindGroup;
  private materialTextures: GPUTexture[] = [];

  private constructor(
    canvas: HTMLCanvasElement,
    device: GPUDevice,
    context: GPUCanvasContext,
    format: GPUTextureFormat,
  ) {
    this.device = device;
    this.context = context;
    this.format = format;

    this.context.configure({
      device: this.device,
      format: this.format,
      alphaMode: "opaque",
    });

    this.uniformBuffer = this.device.createBuffer({
      label: "Scene uniforms",
      size: UNIFORM_FLOAT_COUNT * BYTES_PER_FLOAT,
      usage: GPU_BUFFER_USAGE.UNIFORM | GPU_BUFFER_USAGE.COPY_DST,
    });

    const shadowBindGroupLayout = this.device.createBindGroupLayout({
      label: "Shadow bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE.VERTEX,
          buffer: { type: "uniform" },
        },
      ],
    });

    this.mainBindGroupLayout = this.device.createBindGroupLayout({
      label: "Material bind group layout",
      entries: [
        {
          binding: 0,
          visibility: GPU_SHADER_STAGE.VERTEX | GPU_SHADER_STAGE.FRAGMENT,
          buffer: { type: "uniform" },
        },
        {
          binding: 1,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 2,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 3,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          texture: { sampleType: "float" },
        },
        {
          binding: 4,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          sampler: { type: "filtering" },
        },
        {
          binding: 5,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          texture: { sampleType: "depth" },
        },
        {
          binding: 6,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          sampler: { type: "comparison" },
        },
        {
          binding: 7,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 8,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
        {
          binding: 9,
          visibility: GPU_SHADER_STAGE.FRAGMENT,
          buffer: { type: "read-only-storage" },
        },
      ],
    });

    this.sampler = this.device.createSampler({
      label: "Material sampler",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      magFilter: "linear",
      minFilter: "linear",
    });
    this.shadowSampler = this.device.createSampler({
      label: "Shadow comparison sampler",
      compare: "less-equal",
      magFilter: "linear",
      minFilter: "linear",
    });

    this.shadowDepthTexture = this.device.createTexture({
      label: "Shadow depth texture",
      size: [SHADOW_MAP_SIZE, SHADOW_MAP_SIZE],
      format: "depth24plus",
      usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT | GPU_TEXTURE_USAGE.TEXTURE_BINDING,
    });
    this.shadowDepthView = this.shadowDepthTexture.createView();

    this.depthTexture = this.createDepthTexture(canvas.width, canvas.height);
    this.depthTextureView = this.depthTexture.createView();

    const vertexBuffers: GPUVertexBufferLayout[] = [
      {
        arrayStride: VERTEX_STRIDE,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x3" },
          { shaderLocation: 1, offset: 12, format: "float32x3" },
          { shaderLocation: 2, offset: 24, format: "float32x3" },
          { shaderLocation: 3, offset: 36, format: "float32x2" },
          { shaderLocation: 4, offset: 44, format: "float32x4" },
        ],
      },
    ];

    const mainShaderModule = this.device.createShaderModule({
      label: "Main WebGPU renderer shader",
      code: MAIN_SHADER,
    });
    this.mainPipeline = this.device.createRenderPipeline({
      label: "Main WebGPU renderer pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.mainBindGroupLayout],
      }),
      vertex: {
        module: mainShaderModule,
        entryPoint: "vertex_main",
        buffers: vertexBuffers,
      },
      fragment: {
        module: mainShaderModule,
        entryPoint: "fragment_main",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "none",
        frontFace: "ccw",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });
    this.backgroundPipeline = this.device.createRenderPipeline({
      label: "Environment background WebGPU pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [this.mainBindGroupLayout],
      }),
      vertex: {
        module: mainShaderModule,
        entryPoint: "background_vertex_main",
      },
      fragment: {
        module: mainShaderModule,
        entryPoint: "background_fragment_main",
        targets: [{ format: this.format }],
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "none",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: false,
        depthCompare: "always",
      },
    });

    const shadowShaderModule = this.device.createShaderModule({
      label: "Shadow WebGPU renderer shader",
      code: SHADOW_SHADER,
    });
    this.shadowPipeline = this.device.createRenderPipeline({
      label: "Shadow WebGPU renderer pipeline",
      layout: this.device.createPipelineLayout({
        bindGroupLayouts: [shadowBindGroupLayout],
      }),
      vertex: {
        module: shadowShaderModule,
        entryPoint: "vertex_main",
        buffers: vertexBuffers,
      },
      primitive: {
        topology: "triangle-list",
        cullMode: "none",
        frontFace: "ccw",
      },
      depthStencil: {
        format: "depth24plus",
        depthWriteEnabled: true,
        depthCompare: "less",
      },
    });

    this.shadowBindGroup = this.device.createBindGroup({
      label: "Shadow bind group",
      layout: shadowBindGroupLayout,
      entries: [{ binding: 0, resource: { buffer: this.uniformBuffer } }],
    });
  }

  static async create(canvas: HTMLCanvasElement) {
    if (!navigator.gpu) {
      throw new Error("WebGPU is not available in this browser");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("No WebGPU adapter was found");
    }

    const device = await adapter.requestDevice();
    const context = canvas.getContext("webgpu") as GPUCanvasContext | null;
    if (!context) {
      throw new Error("Could not create a WebGPU canvas context");
    }

    const format = navigator.gpu.getPreferredCanvasFormat();
    return new WebGpuRenderer(canvas, device, context, format);
  }

  canRender(renderMode?: RenderMode) {
    return !renderMode || renderMode === "filled";
  }

  get maxTextureDimension2D() {
    return this.device.limits.maxTextureDimension2D;
  }

  resize(width: number, height: number) {
    this.depthTexture.destroy();
    this.depthTexture = this.createDepthTexture(width, height);
    this.depthTextureView = this.depthTexture.createView();
  }

  render(params: WebGpuRenderParams) {
    if (!this.canRender(params.renderMode)) {
      return;
    }

    if (!this.vertexBuffer || this.uploadedMesh !== params.model) {
      this.uploadMesh(params.model);
    }
    let bindGroupDirty = false;
    if (this.uploadedIblData !== params.iblData) {
      this.uploadIblData(params.iblData);
      bindGroupDirty = true;
    }
    if (this.uploadedMaterial !== params.material) {
      this.uploadMaterial(params.material);
      bindGroupDirty = true;
    }
    if (!this.materialBindGroup || bindGroupDirty) {
      this.createMaterialBindGroup();
    }
    if (!this.vertexBuffer || !this.materialBindGroup || this.vertexCount === 0) {
      return;
    }

    this.writeUniforms(params);

    const commandEncoder = this.device.createCommandEncoder({
      label: "WebGPU renderer command encoder",
    });

    if (params.useShadows) {
      const shadowPass = commandEncoder.beginRenderPass({
        label: "Shadow pass",
        colorAttachments: [],
        depthStencilAttachment: {
          view: this.shadowDepthView,
          depthClearValue: 1,
          depthLoadOp: "clear",
          depthStoreOp: "store",
        },
      });
      shadowPass.setPipeline(this.shadowPipeline);
      shadowPass.setBindGroup(0, this.shadowBindGroup);
      shadowPass.setVertexBuffer(0, this.vertexBuffer);
      shadowPass.draw(this.vertexCount);
      shadowPass.end();
    }

    const renderPass = commandEncoder.beginRenderPass({
      label: "Main render pass",
      colorAttachments: [
        {
          view: this.context.getCurrentTexture().createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 1 },
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: this.depthTextureView,
        depthClearValue: 1,
        depthLoadOp: "clear",
        depthStoreOp: "store",
      },
    });
    if (params.showEnvironmentBackground) {
      renderPass.setPipeline(this.backgroundPipeline);
      renderPass.setBindGroup(0, this.materialBindGroup);
      renderPass.draw(3);
    }
    renderPass.setPipeline(this.mainPipeline);
    renderPass.setBindGroup(0, this.materialBindGroup);
    renderPass.setVertexBuffer(0, this.vertexBuffer);
    renderPass.draw(this.vertexCount);
    renderPass.end();

    this.device.queue.submit([commandEncoder.finish()]);
  }

  private createDepthTexture(width: number, height: number) {
    return this.device.createTexture({
      label: "Main depth texture",
      size: [Math.max(1, width), Math.max(1, height)],
      format: "depth24plus",
      usage: GPU_TEXTURE_USAGE.RENDER_ATTACHMENT,
    });
  }

  private uploadMesh(mesh: Mesh) {
    const vertexData = new Float32Array(mesh.vertices.length * FLOATS_PER_VERTEX);
    let offset = 0;
    for (let i = 0; i < mesh.vertices.length; i++) {
      const position = mesh.vertices[i];
      const normal = mesh.normals[i] ?? Vector3.Forward;
      const faceNormal = mesh.faceNormals[i] ?? normal;
      const uv = mesh.uvs[i];
      const tangent = mesh.tangents[i];

      vertexData[offset++] = position.x;
      vertexData[offset++] = position.y;
      vertexData[offset++] = position.z;
      vertexData[offset++] = normal.x;
      vertexData[offset++] = normal.y;
      vertexData[offset++] = normal.z;
      vertexData[offset++] = faceNormal.x;
      vertexData[offset++] = faceNormal.y;
      vertexData[offset++] = faceNormal.z;
      vertexData[offset++] = uv?.x ?? 0;
      vertexData[offset++] = uv?.y ?? 0;
      vertexData[offset++] = tangent?.x ?? 1;
      vertexData[offset++] = tangent?.y ?? 0;
      vertexData[offset++] = tangent?.z ?? 0;
      vertexData[offset++] = tangent?.w ?? 1;
    }

    this.vertexBuffer?.destroy();
    this.vertexBuffer = this.device.createBuffer({
      label: "Mesh vertex buffer",
      size: Math.max(4, vertexData.byteLength),
      usage: GPU_BUFFER_USAGE.VERTEX | GPU_BUFFER_USAGE.COPY_DST,
    });
    if (vertexData.byteLength > 0) {
      this.device.queue.writeBuffer(this.vertexBuffer, 0, vertexData);
    }
    this.vertexCount = mesh.vertices.length;
    this.uploadedMesh = mesh;
  }

  private uploadMaterial(material: Material) {
    for (const texture of this.materialTextures) {
      texture.destroy();
    }
    this.materialTextures = [
      this.createGpuTexture(material.colorTexture, "color"),
      this.createGpuTexture(material.normalTexture, "normal"),
      this.createGpuTexture(material.ormTexture, "color"),
    ];
    this.uploadedMaterial = material;
  }

  private uploadIblData(iblData: IblData) {
    this.diffuseIblBuffer?.destroy();
    this.specularIblBuffer?.destroy();
    this.brdfIblBuffer?.destroy();
    this.diffuseIblBuffer = this.createStorageBuffer(iblData.diffuseIrradianceMap, "Diffuse IBL");
    this.specularIblBuffer = this.createStorageBuffer(iblData.specularPrefilterMap, "Specular IBL");
    this.brdfIblBuffer = this.createStorageBuffer(iblData.specularBrdfLut, "BRDF IBL");
    this.uploadedIblData = iblData;
  }

  private createStorageBuffer(data: Float32Array, label: string) {
    const buffer = this.device.createBuffer({
      label,
      size: Math.max(4, data.byteLength),
      usage: GPU_BUFFER_USAGE.STORAGE | GPU_BUFFER_USAGE.COPY_DST,
    });
    if (data.byteLength > 0) {
      this.device.queue.writeBuffer(buffer, 0, data);
    }
    return buffer;
  }

  private createMaterialBindGroup() {
    if (
      this.materialTextures.length !== 3 ||
      !this.diffuseIblBuffer ||
      !this.specularIblBuffer ||
      !this.brdfIblBuffer
    ) {
      return;
    }

    this.materialBindGroup = this.device.createBindGroup({
      label: "Material bind group",
      layout: this.mainBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.uniformBuffer } },
        { binding: 1, resource: this.materialTextures[0].createView() },
        { binding: 2, resource: this.materialTextures[1].createView() },
        { binding: 3, resource: this.materialTextures[2].createView() },
        { binding: 4, resource: this.sampler },
        { binding: 5, resource: this.shadowDepthView },
        { binding: 6, resource: this.shadowSampler },
        { binding: 7, resource: { buffer: this.diffuseIblBuffer } },
        { binding: 8, resource: { buffer: this.specularIblBuffer } },
        { binding: 9, resource: { buffer: this.brdfIblBuffer } },
      ],
    });
  }

  private createGpuTexture(texture: Texture, kind: "color" | "normal") {
    const rgba = new Uint8Array(texture.width * texture.height * 4);
    for (let texel = 0; texel < texture.width * texture.height; texel++) {
      const src = texel * 3;
      const dst = texel * 4;
      if (kind === "normal") {
        rgba[dst] = toUnorm8(texture.data[src] * 0.5 + 0.5);
        rgba[dst + 1] = toUnorm8(texture.data[src + 1] * 0.5 + 0.5);
        rgba[dst + 2] = toUnorm8(texture.data[src + 2] * 0.5 + 0.5);
      } else {
        rgba[dst] = toUnorm8(texture.data[src]);
        rgba[dst + 1] = toUnorm8(texture.data[src + 1]);
        rgba[dst + 2] = toUnorm8(texture.data[src + 2]);
      }
      rgba[dst + 3] = 255;
    }

    const rowBytes = texture.width * 4;
    const bytesPerRow = Math.ceil(rowBytes / 256) * 256;
    const uploadData =
      bytesPerRow === rowBytes ? rgba : new Uint8Array(bytesPerRow * texture.height);
    if (uploadData !== rgba) {
      for (let y = 0; y < texture.height; y++) {
        uploadData.set(rgba.subarray(y * rowBytes, (y + 1) * rowBytes), y * bytesPerRow);
      }
    }

    const gpuTexture = this.device.createTexture({
      label: `${kind} material texture`,
      size: [texture.width, texture.height],
      format: "rgba8unorm",
      usage: GPU_TEXTURE_USAGE.TEXTURE_BINDING | GPU_TEXTURE_USAGE.COPY_DST,
    });
    this.device.queue.writeTexture(
      { texture: gpuTexture },
      uploadData,
      {
        bytesPerRow,
        rowsPerImage: texture.height,
      },
      [texture.width, texture.height],
    );
    return gpuTexture;
  }

  private writeUniforms(params: WebGpuRenderParams) {
    this.uniformData.set(params.mvp.m, UNIFORM_MVP_OFFSET);
    this.uniformData.set(params.modelMat.m, UNIFORM_MODEL_OFFSET);
    this.uniformData.set(params.normalMat.m, UNIFORM_NORMAL_OFFSET);
    this.uniformData.set(params.worldLightSpaceMat.m, UNIFORM_LIGHT_SPACE_OFFSET);
    vectorToUniform(this.uniformData, UNIFORM_WORLD_LIGHT_OFFSET, params.worldLightDir);
    vectorToUniform(this.uniformData, UNIFORM_WORLD_CAM_OFFSET, params.worldCamPos, 1);
    vectorToUniform(this.uniformData, UNIFORM_WORLD_VIEW_OFFSET, params.worldViewDir);

    this.uniformData[UNIFORM_MATERIAL_FACTORS_OFFSET] = params.material.occlusionStrength;
    this.uniformData[UNIFORM_MATERIAL_FACTORS_OFFSET + 1] = params.material.roughnessFactor;
    this.uniformData[UNIFORM_MATERIAL_FACTORS_OFFSET + 2] = params.material.metallicFactor;
    this.uniformData[UNIFORM_MATERIAL_FACTORS_OFFSET + 3] = 0;

    this.uniformData[UNIFORM_FLAGS_OFFSET] = MODE_BY_MATERIAL[params.materialMode];
    this.uniformData[UNIFORM_FLAGS_OFFSET + 1] = params.orthographic ? 1 : 0;
    this.uniformData[UNIFORM_FLAGS_OFFSET + 2] = params.tonemap ? 1 : 0;
    this.uniformData[UNIFORM_FLAGS_OFFSET + 3] = params.useShadows ? 1 : 0;

    this.uniformData[UNIFORM_ENV_YAW_OFFSET] = params.envYaw.sin;
    this.uniformData[UNIFORM_ENV_YAW_OFFSET + 1] = params.envYaw.cos;
    this.uniformData[UNIFORM_ENV_YAW_OFFSET + 2] = 0;
    this.uniformData[UNIFORM_ENV_YAW_OFFSET + 3] = 0;

    this.uniformData[UNIFORM_CAMERA_OFFSET] = params.aspectRatio;
    this.uniformData[UNIFORM_CAMERA_OFFSET + 1] = Math.tan((params.fov * Math.PI) / 360);
    this.uniformData[UNIFORM_CAMERA_OFFSET + 2] = 0;
    this.uniformData[UNIFORM_CAMERA_OFFSET + 3] = 0;

    this.device.queue.writeBuffer(this.uniformBuffer, 0, this.uniformData);
  }
}
