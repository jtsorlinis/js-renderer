struct Vertex {
  @location(0) pos : vec4f,
  @location(1) norm : vec3f,
  @location(2) uv : vec2f
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
 
@vertex
fn vertex(@location(0) position: vec4<f32>) -> @builtin(position) vec4<f32> {
  return uniforms.lightMVP * position;
}
