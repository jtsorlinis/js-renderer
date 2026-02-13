import"./index-BDYN7ibo.js";import{l as ne,V as c,d as oe,n as re,M as d,r as ae,m as ie}from"./renderSettings-B9onYS4J.js";const se=`const MODE_NORMAL_MAPPED: i32 = 0;
const MODE_TEXTURED: i32 = 1;
const MODE_SMOOTH: i32 = 2;
const SHADOW_BIAS: f32 = 0.0001;
const SPEC_STRENGTH: f32 = 0.25;
const SHININESS: f32 = 16.0;
const AMBIENT: f32 = 0.1;
const SHADE_SCALE: f32 = 0.8;

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
  return select(0.0, 1.0, lightSpacePos.z - SHADOW_BIAS <= depth);
}

@vertex
fn vertex(v: Vertex) -> V2f {
  var o: V2f;

  o.pos = uniforms.mvp * v.pos;
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
  let mode = i32(round(uniforms.settings.x));
  let useShadows = uniforms.settings.y > 0.5;

  var normal = vec3f(0.0, 0.0, 1.0);
  var lightDir = normalize(uniforms.lightDir);
  var viewDir = normalize(uniforms.camPos - i.worldPos);
  var albedo = vec3f(1.0);
  var shadeScale = 1.0;

  switch mode {
    case MODE_NORMAL_MAPPED: {
      normal = normalize(textureSample(normalTex, texSampler, i.uv).xyz * 2.0 - 1.0);
      lightDir = normalize(i.lightDirTS);
      viewDir = normalize(i.viewDirTS);
      albedo = textureSample(diffuseTex, texSampler, i.uv).xyz;
    }
    case MODE_TEXTURED: {
      normal = normalize(i.worldNorm);
      albedo = textureSample(diffuseTex, texSampler, i.uv).xyz;
    }
    case MODE_SMOOTH: {
      normal = normalize(i.worldNorm);
      shadeScale = SHADE_SCALE;
    }
    default: {
      normal = normalize(cross(dpdx(i.worldPos), dpdy(i.worldPos)));
      shadeScale = SHADE_SCALE;
    }
  }

  let diffuse = max(0.0, -dot(normal, lightDir));
  let halfDir = normalize(viewDir - lightDir);
  let specular = pow(max(0.0, dot(normal, halfDir)), SHININESS) * SPEC_STRENGTH;

  var shadow = 1.0;
  if (useShadows) {
    shadow = shadowFactor(i.lightSpacePos);
  }

  let lighting = ((diffuse + specular) * shadow + AMBIENT) * shadeScale;
  return vec4f(albedo * lighting, 1.0);
}
`,ce=`struct Uniforms {
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
  return uniforms.lightMVP * position;
}
`,le=`struct Uniforms {
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
`,m=15,N=m*Float32Array.BYTES_PER_ELEMENT,y=4,me=y*Float32Array.BYTES_PER_ELEMENT,fe=84,de=5,R=250,V=250,U=100,s={model:0,mvp:16,normal:32,lightMvp:48,camPos:64,lightDir:68,modelLightDir:72,modelCamPos:76,settings:80},ue={normalMapped:0,textured:1,smooth:2,flat:3},i=document.getElementById("canvas"),he=document.getElementById("fps"),ge=document.getElementById("tris"),G=document.getElementById("orthoCb"),T=document.getElementById("shadingDd");i.width=1200;i.height=800;const pe=await navigator.gpu?.requestAdapter(),t=await pe?.requestDevice();if(!t)throw new Error("WebGPU is not supported");const b=i.getContext("webgpu");if(!b)throw new Error("WebGPU is not supported");const M=navigator.gpu.getPreferredCanvasFormat();b.configure({device:t,format:M});const I=async e=>{const r=new Image;r.src=e,await r.decode();const l=await createImageBitmap(r,{colorSpaceConversion:"none"}),g=t.createTexture({format:"rgba8unorm",size:[l.width,l.height],usage:GPUTextureUsage.COPY_DST|GPUTextureUsage.TEXTURE_BINDING|GPUTextureUsage.RENDER_ATTACHMENT});return t.queue.copyExternalImageToTexture({source:l,flipY:!0},{texture:g},{width:l.width,height:l.height}),g},F=e=>t.createTexture({size:{width:i.width,height:i.height},format:"depth24plus",usage:e}),[ve,we]=await Promise.all([I(oe),I(re)]),xe=t.createSampler({magFilter:"nearest",minFilter:"nearest"}),O=t.createShaderModule({code:se}),Se=t.createShaderModule({code:ce}),L=t.createShaderModule({code:le}),o=ne(ie);ge.innerText=(o.vertices.length/3).toFixed(0);const f=new Float32Array(o.vertices.length*m);for(let e=0;e<o.vertices.length;e++)f.set(o.vertices[e].extend(1).toArray(),e*m),f.set(o.normals[e].toArray(),e*m+4),f.set(o.uvs[e].toArray(),e*m+7),f.set(o.tangents[e].toArray(),e*m+9),f.set(o.bitangents[e].toArray(),e*m+12);const Y=o.vertices.length/3*6,A=new Float32Array(Y*y);let z=0;const u=e=>{A.set(o.vertices[e].extend(1).toArray(),z),z+=y};for(let e=0;e<o.vertices.length;e+=3)u(e),u(e+1),u(e+1),u(e+2),u(e+2),u(e);const P=t.createBuffer({size:f.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(P,0,f);const H=t.createBuffer({size:A.byteLength,usage:GPUBufferUsage.VERTEX|GPUBufferUsage.COPY_DST});t.queue.writeBuffer(H,0,A);const X=t.createRenderPipeline({layout:"auto",depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"},vertex:{module:Se,entryPoint:"vertex",buffers:[{arrayStride:N,attributes:[{shaderLocation:0,offset:0,format:"float32x4"}]}]}}),W=t.createRenderPipeline({layout:"auto",depthStencil:{format:"depth24plus",depthWriteEnabled:!0,depthCompare:"less"},vertex:{module:O,entryPoint:"vertex",buffers:[{arrayStride:N,attributes:[{shaderLocation:0,offset:0,format:"float32x4"},{shaderLocation:1,offset:16,format:"float32x3"},{shaderLocation:2,offset:28,format:"float32x2"},{shaderLocation:3,offset:36,format:"float32x3"},{shaderLocation:4,offset:48,format:"float32x3"}]}]},fragment:{module:O,entryPoint:"fragment",targets:[{format:M}]},primitive:{topology:"triangle-list",frontFace:"cw",cullMode:"back"}}),q=t.createRenderPipeline({layout:"auto",vertex:{module:L,entryPoint:"vertex",buffers:[{arrayStride:me,attributes:[{shaderLocation:0,offset:0,format:"float32x4"}]}]},fragment:{module:L,entryPoint:"fragment",targets:[{format:M}]},primitive:{topology:"line-list",frontFace:"cw",cullMode:"none"}}),Te=F(GPUTextureUsage.RENDER_ATTACHMENT),k=F(GPUTextureUsage.RENDER_ATTACHMENT|GPUTextureUsage.TEXTURE_BINDING),a=new Float32Array(fe),S=t.createBuffer({size:a.byteLength,usage:GPUBufferUsage.UNIFORM|GPUBufferUsage.COPY_DST}),Ee=t.createBindGroup({layout:W.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:S}},{binding:1,resource:xe},{binding:2,resource:ve.createView()},{binding:3,resource:we.createView()},{binding:4,resource:k.createView()}]}),Pe=t.createBindGroup({layout:X.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:S}}]}),De=t.createBindGroup({layout:q.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:S}}]}),D=new c(0,0,0),x=new c(0,-Math.PI/2,0),ye=new c(1,1,1),w=new c(0,0,-2.5),v=new c(0,-1,1).normalize(),E=i.width/i.height;let h=1.5;const be=()=>{const e=ae(T.value,o.uvs.length>0);return e.normalizedValue!==T.value&&(T.value=e.normalizedValue),{mode:ue[e.material],useShadows:e.useShadows,wireframe:e.wireframe}},Me=e=>{x.y-=e/de},Ae=()=>{const e=be(),r=d.TRS(D,x,ye),l=d.LookTo(v.scale(-5),v,c.Up),g=d.Ortho(h,E),Z=r.multiply(l.multiply(g)),_=r.invert(),J=d.LookTo(w,c.Forward,c.Up),K=G.checked?d.Ortho(h,E):d.Perspective(60,E),Q=r.multiply(J).multiply(K),$=r.invert().transpose(),ee=_.multiplyDirection(v).normalize(),te=_.multiplyPoint(w).xyz;a.set(r.toArray(),s.model),a.set(Q.toArray(),s.mvp),a.set($.toArray(),s.normal),a.set(Z.toArray(),s.lightMvp),a.set(w.toArray(),s.camPos),a.set(v.toArray(),s.lightDir),a.set(ee.toArray(),s.modelLightDir),a.set(te.toArray(),s.modelCamPos),a.set([e.mode,e.useShadows?1:0,0,0],s.settings),t.queue.writeBuffer(S,0,a);const p=t.createCommandEncoder();if(e.useShadows){const n=p.beginRenderPass({colorAttachments:[],depthStencilAttachment:{view:k.createView(),depthLoadOp:"clear",depthStoreOp:"store",depthClearValue:1}});n.setPipeline(X),n.setBindGroup(0,Pe),n.setVertexBuffer(0,P),n.draw(o.vertices.length),n.end()}const B={view:b.getCurrentTexture().createView(),clearValue:[0,0,0,1],loadOp:"clear",storeOp:"store"};if(e.wireframe){const n=p.beginRenderPass({colorAttachments:[B]});n.setPipeline(q),n.setBindGroup(0,De),n.setVertexBuffer(0,H),n.draw(Y),n.end()}else{const n=p.beginRenderPass({colorAttachments:[B],depthStencilAttachment:{view:Te.createView(),depthLoadOp:"clear",depthStoreOp:"store",depthClearValue:1}});n.setPipeline(W),n.setBindGroup(0,Ee),n.setVertexBuffer(0,P),n.draw(o.vertices.length),n.end()}t.queue.submit([p.finish()])};let C=0;const j=()=>{const e=performance.now(),r=(e-C)/1e3;C=e,Me(r),Ae(),he.innerText=(performance.now()-e).toFixed(1),requestAnimationFrame(j)};i.onmousemove=e=>{e.buttons===1?(x.y-=e.movementX/R,x.x+=e.movementY/R):(e.buttons===2||e.buttons===4)&&(D.x+=e.movementX/V,D.y-=e.movementY/V)};i.onwheel=e=>{e.preventDefault(),G.checked?(h+=e.deltaY/U,h=Math.max(.01,h)):w.z-=e.deltaY/U};i.oncontextmenu=e=>e.preventDefault();j();
