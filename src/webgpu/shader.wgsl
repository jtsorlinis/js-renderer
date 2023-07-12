struct Vertex {
  @location(0) pos : vec4f,
  @location(1) norm : vec3f,
  @location(2) uv : vec2f
}
 
struct V2f {
  @builtin(position) pos : vec4f,
  @location(0) norm : vec3f,
  @location(1) uv : vec2f,
  @location(2) modelPos : vec3f,
  @location(3) lightSpacePos : vec3f
}

struct Uniforms {
  model : mat4x4f,
  view : mat4x4f,
  proj : mat4x4f,
  norm : mat4x4f,
  lightMVP : mat4x4f,
  camPos : vec3f,
  mLightDir : vec3f,
  mCamPos : vec3f
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var diffuseTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;
@group(0) @binding(4) var shadowMap: texture_depth_2d;
 
 @vertex 
 fn vertex(
  v: Vertex,
  @builtin(vertex_index) vertexIndex : u32) -> V2f {


  var o: V2f;
  o.pos = uniforms.proj * uniforms.view * uniforms.model * v.pos;
  o.norm = (uniforms.norm * vec4f(v.norm,0)).xyz;
  o.uv = v.uv;
  o.modelPos = v.pos.xyz;
  let lightSpacePos = uniforms.lightMVP * v.pos;
  o.lightSpacePos = vec3f(lightSpacePos.xy * vec2f(0.5, -0.5) + 0.5, lightSpacePos.z);
  return o;
}

@fragment 
fn fragment(i: V2f) -> @location(0) vec4f {
  let norm = textureSample(normalTex, texSampler, i.uv).xyz * 2 - 1;

  // Diffuse
  var diffuse = max(0,-dot(norm, uniforms.mLightDir));

  // Specular
  let viewDir = normalize(uniforms.mCamPos - i.modelPos);
  let reflectDir = reflect(uniforms.mLightDir, norm);
  let halfDir = normalize(viewDir - uniforms.mLightDir);
  let specular = pow(max(0, dot(norm, halfDir)), 16) * 0.25;

  // Shadows
  let depth = textureSample(shadowMap, texSampler, i.lightSpacePos.xy);
  if (i.lightSpacePos.z - 0.00001 > depth) {
    diffuse *= 0;
  }

  let lighting = diffuse + specular + 0.1;
  let col = textureSample(diffuseTex, texSampler, i.uv);

  
  return col * lighting;
}