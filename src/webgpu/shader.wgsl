struct Vertex {
  @location(0) pos : vec4f,
  @location(1) norm : vec3f,
  @location(2) uv : vec2f
}
 
struct V2f {
  @builtin(position) pos : vec4f,
  @location(0) norm : vec3f,
  @location(1) uv : vec2f,
  @location(2) modelPos : vec3f
}

struct Uniforms {
  model : mat4x4f,
  view : mat4x4f,
  proj : mat4x4f,
  norm : mat4x4f,
  camPos : vec3f,
  mLightDir : vec3f,
  mCamPos : vec3f
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;
@group(0) @binding(1) var texSampler: sampler;
@group(0) @binding(2) var diffuseTex: texture_2d<f32>;
@group(0) @binding(3) var normalTex: texture_2d<f32>;

 
 @vertex 
 fn vertex(
  v: Vertex,
  @builtin(vertex_index) vertexIndex : u32) -> V2f {


  var o: V2f;
  o.pos = uniforms.proj * uniforms.view * uniforms.model * v.pos;
  o.norm = (uniforms.norm * vec4f(v.norm,0)).xyz;
  o.uv = v.uv;
  o.modelPos = v.pos.xyz;
  return o;
}

@fragment 
fn fragment(i: V2f) -> @location(0) vec4f {
  let norm = textureSample(normalTex, texSampler, i.uv).xyz * 2 - 1;
  let viewDir = normalize(uniforms.mCamPos - i.modelPos);
  let reflectDir = reflect(uniforms.mLightDir, norm);
  let diffuse = max(0,-dot(norm, uniforms.mLightDir));
  let specular = pow(max(0, dot(viewDir, reflectDir)), 32) * .2;
  let lighting = diffuse + specular + 0.1;
  let col = textureSample(diffuseTex, texSampler, i.uv);
  return col * lighting;
}