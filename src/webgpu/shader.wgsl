struct Vertex {
  @location(0) pos : vec4f,
  @location(1) norm : vec3f,
  @location(2) uv : vec2f,
  @location(3) tangent : vec3f,
  @location(4) bitangent : vec3f,
}

struct V2f {
  @builtin(position) pos : vec4f,
  @location(0) uv : vec2f,
  @location(1) lightDirTS : vec3f,
  @location(2) viewDirTS : vec3f,
  @location(3) lightSpacePos : vec3f,
  @location(4) worldNorm : vec3f,
  @location(5) worldPos : vec3f,
}

struct Uniforms {
  model : mat4x4f,
  view : mat4x4f,
  proj : mat4x4f,
  norm : mat4x4f,
  lightMVP : mat4x4f,
  camPos : vec3f,
  lightDir : vec3f,
  mLightDir : vec3f,
  mCamPos : vec3f,
  settings : vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var diffuseTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var shadowMap: texture_depth_2d;

fn shadowFactor(lightSpacePos: vec3f) -> f32 {
  let shadowDim = textureDimensions(shadowMap);
  let shadowCoord = vec2i(
    clamp(
      lightSpacePos.xy * vec2f(shadowDim),
      vec2f(0.0),
      vec2f(shadowDim) - vec2f(1.0),
    ),
  );
  let depth = textureLoad(shadowMap, shadowCoord, 0);
  return select(0.0, 1.0, lightSpacePos.z - 0.0001 <= depth);
}

@vertex
fn vertex(v: Vertex) -> V2f {
  var o: V2f;
  o.pos = uniforms.proj * uniforms.view * uniforms.model * v.pos;
  o.uv = v.uv;

  let worldPos = uniforms.model * v.pos;
  o.worldPos = worldPos.xyz;
  o.worldNorm = normalize((uniforms.norm * vec4f(v.norm, 0.0)).xyz);

  let n = normalize(v.norm);
  let t = normalize(v.tangent - n * dot(n, v.tangent));
  let bRef = normalize(v.bitangent - n * dot(n, v.bitangent));
  let bSign = select(-1.0, 1.0, dot(cross(n, t), bRef) >= 0.0);
  let b = normalize(cross(n, t)) * bSign;
  let modelPos = v.pos.xyz;
  let viewDir = normalize(uniforms.mCamPos - modelPos);
  o.lightDirTS = vec3f(
    dot(t, uniforms.mLightDir),
    dot(b, uniforms.mLightDir),
    dot(n, uniforms.mLightDir),
  );
  o.viewDirTS = vec3f(dot(t, viewDir), dot(b, viewDir), dot(n, viewDir));

  let lightSpacePos = uniforms.lightMVP * v.pos;
  o.lightSpacePos = vec3f(lightSpacePos.xy * vec2f(0.5, -0.5) + 0.5, lightSpacePos.z);
  return o;
}

@fragment
fn fragment(i: V2f) -> @location(0) vec4f {
  let mode = i32(uniforms.settings.x);
  let useShadows = uniforms.settings.y > 0.5;

  var normal = vec3f(0.0, 0.0, 1.0);
  var lightDir = normalize(uniforms.lightDir);
  var viewDir = normalize(uniforms.camPos - i.worldPos);
  var colour = vec3f(1.0);
  var shadeScale = 1.0;

  if (mode == 0) {
    normal = normalize(textureSample(normalTex, texSampler, i.uv).xyz * 2.0 - 1.0);
    lightDir = normalize(i.lightDirTS);
    viewDir = normalize(i.viewDirTS);
    colour = textureSample(diffuseTex, texSampler, i.uv).xyz;
  } else if (mode == 1) {
    normal = normalize(i.worldNorm);
    colour = textureSample(diffuseTex, texSampler, i.uv).xyz;
  } else if (mode == 2) {
    normal = normalize(i.worldNorm);
    shadeScale = 0.8;
  } else {
    normal = normalize(cross(dpdx(i.worldPos), dpdy(i.worldPos)));
    shadeScale = 0.8;
  }

  let diffuse = max(0.0, -dot(normal, lightDir));
  let halfDir = normalize(viewDir - lightDir);
  let specular = pow(max(0.0, dot(normal, halfDir)), 16.0) * 0.25;

  var shadow = 1.0;
  if (useShadows) {
    shadow = shadowFactor(i.lightSpacePos);
  }

  let lighting = ((diffuse + specular) * shadow + 0.1) * shadeScale;
  return vec4f(colour * lighting, 1.0);
}
