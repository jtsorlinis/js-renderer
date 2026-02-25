struct Uniforms {
  model : mat4x4f,
  mvp : mat4x4f,
  norm : mat4x4f,
  lightMVP : mat4x4f,
  camPos : vec3f,
  lightDir : vec3f,
  mLightDir : vec3f,
  mCamPos : vec3f,
  settings : vec4f,
}

@group(0) @binding(0) var<uniform> uniforms: Uniforms;

@vertex
fn vertex(@location(0) position: vec4f) -> @builtin(position) vec4f {
  return uniforms.mvp * position;
}

@fragment
fn fragment() -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, 1.0);
}
