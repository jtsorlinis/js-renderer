import "../style.css";
import shader from "./shader.wgsl?raw";
import shadowShader from "./shadow.wgsl?raw";
import { loadObj } from "../utils/objLoader";
import head from "../models/head.obj?raw";
import headDiffuse from "../models/head_diffuse.png";
import headNormal from "../models/head_normal_t.png";
import { Matrix4, Vector3 } from "../maths";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;
const trisText = document.getElementById("tris") as HTMLSpanElement;
const orthographicCb = document.getElementById("orthoCb") as HTMLInputElement;
const shadingDd = document.getElementById("shadingDd") as HTMLSelectElement;

canvas.width = 1200;
canvas.height = 800;

const adapter = await navigator.gpu?.requestAdapter();
const device = await adapter?.requestDevice();

if (!device) {
  throw new Error("WebGPU is not supported");
}

const ctx = canvas.getContext("webgpu");
if (!ctx) {
  throw new Error("WebGPU is not supported");
}
const format = navigator.gpu.getPreferredCanvasFormat();
ctx.configure({ device, format });

const diffuseImage = new Image();
diffuseImage.src = headDiffuse;
await diffuseImage.decode();
const diffuseSource = await createImageBitmap(diffuseImage, {
  colorSpaceConversion: "none",
});

const diffuseTexture = device.createTexture({
  format: "rgba8unorm",
  size: [diffuseSource.width, diffuseSource.height],
  usage:
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.RENDER_ATTACHMENT,
});

device.queue.copyExternalImageToTexture(
  { source: diffuseSource, flipY: true },
  { texture: diffuseTexture },
  { width: diffuseSource.width, height: diffuseSource.height },
);

const normalImage = new Image();
normalImage.src = headNormal;
await normalImage.decode();
const normalSource = await createImageBitmap(normalImage, {
  colorSpaceConversion: "none",
});

const normalTexture = device.createTexture({
  format: "rgba8unorm",
  size: [normalSource.width, normalSource.height],
  usage:
    GPUTextureUsage.COPY_DST |
    GPUTextureUsage.TEXTURE_BINDING |
    GPUTextureUsage.RENDER_ATTACHMENT,
});

device.queue.copyExternalImageToTexture(
  { source: normalSource, flipY: true },
  { texture: normalTexture },
  { width: normalSource.width, height: normalSource.height },
);

const sampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest",
});

const module = device.createShaderModule({
  code: shader,
});

const shadowModule = device.createShaderModule({
  code: shadowShader,
});

const wireframeModule = device.createShaderModule({
  code: `
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

@vertex
fn vertex(@location(0) position: vec4f) -> @builtin(position) vec4f {
  return uniforms.proj * uniforms.view * uniforms.model * position;
}

@fragment
fn fragment() -> @location(0) vec4f {
  return vec4f(1.0, 1.0, 1.0, 1.0);
}
  `,
});

// Load model
const vertexStride = 15;
const model = loadObj(head);
trisText.innerText = (model.vertices.length / 3).toFixed(0);
const vertexData = new Float32Array(model.vertices.length * vertexStride);

for (let i = 0; i < model.vertices.length; i++) {
  vertexData.set(model.vertices[i].extend(1).toArray(), i * vertexStride);
  vertexData.set(model.normals[i].toArray(), i * vertexStride + 4);
  vertexData.set(model.uvs[i].toArray(), i * vertexStride + 7);
  vertexData.set(model.tangents[i].toArray(), i * vertexStride + 9);
  vertexData.set(model.bitangents[i].toArray(), i * vertexStride + 12);
}

const wireframeVertexCount = (model.vertices.length / 3) * 6;
const wireframeVertexData = new Float32Array(wireframeVertexCount * vertexStride);

const copyVertex = (srcVertexIndex: number, dstVertexIndex: number) => {
  const srcOffset = srcVertexIndex * vertexStride;
  const dstOffset = dstVertexIndex * vertexStride;
  wireframeVertexData.set(
    vertexData.subarray(srcOffset, srcOffset + vertexStride),
    dstOffset,
  );
};

let dstVertex = 0;
for (let i = 0; i < model.vertices.length; i += 3) {
  copyVertex(i, dstVertex++);
  copyVertex(i + 1, dstVertex++);
  copyVertex(i + 1, dstVertex++);
  copyVertex(i + 2, dstVertex++);
  copyVertex(i + 2, dstVertex++);
  copyVertex(i, dstVertex++);
}

const vertexBuffer = device.createBuffer({
  size: vertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, vertexData);

const wireframeVertexBuffer = device.createBuffer({
  size: wireframeVertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(wireframeVertexBuffer, 0, wireframeVertexData);

// Create shadow pipeline
const shadowPipeline = device.createRenderPipeline({
  layout: "auto",
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
  vertex: {
    module: shadowModule,
    entryPoint: "vertex",
    buffers: [
      {
        arrayStride: vertexStride * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" }, // position
        ],
      },
    ],
  },
});

// Create pipeline
const pipeline = device.createRenderPipeline({
  layout: "auto",
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
  vertex: {
    module,
    entryPoint: "vertex",
    buffers: [
      {
        arrayStride: vertexStride * 4,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" }, // position
          { shaderLocation: 1, offset: 16, format: "float32x3" }, // norm
          { shaderLocation: 2, offset: 28, format: "float32x2" }, // uv
          { shaderLocation: 3, offset: 36, format: "float32x3" }, // tangent
          { shaderLocation: 4, offset: 48, format: "float32x3" }, // bitangent
        ],
      },
    ],
  },
  fragment: {
    module,
    entryPoint: "fragment",
    targets: [{ format }],
  },
  primitive: {
    topology: "triangle-list",
    frontFace: "cw",
    cullMode: "back",
  },
});

const wireframePipeline = device.createRenderPipeline({
  layout: "auto",
  vertex: {
    module: wireframeModule,
    entryPoint: "vertex",
    buffers: [
      {
        arrayStride: vertexStride * 4,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
      },
    ],
  },
  fragment: {
    module: wireframeModule,
    entryPoint: "fragment",
    targets: [{ format }],
  },
  primitive: {
    topology: "line-list",
    frontFace: "cw",
    cullMode: "none",
  },
});

// Create z-buffer texture
const depthTexture = device.createTexture({
  size: {
    width: canvas.width,
    height: canvas.height,
  },
  format: "depth24plus",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

// Create shadow depth texture
const shadowDepthTexture = device.createTexture({
  size: {
    width: canvas.width,
    height: canvas.height,
  },
  format: "depth24plus",
  usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
});

// Create uniform buffer
const uniforms = new Float32Array((20 + 5) * 4);
const uniformBuffer = device.createBuffer({
  size: uniforms.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

// Create bind group
const uniformBindGroup = device.createBindGroup({
  layout: pipeline.getBindGroupLayout(0),
  entries: [
    { binding: 0, resource: { buffer: uniformBuffer } },
    { binding: 1, resource: sampler },
    { binding: 2, resource: diffuseTexture.createView() },
    { binding: 3, resource: normalTexture.createView() },
    { binding: 4, resource: shadowDepthTexture.createView() },
  ],
});

const shadowBindGroup = device.createBindGroup({
  layout: shadowPipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
});

const wireframeBindGroup = device.createBindGroup({
  layout: wireframePipeline.getBindGroupLayout(0),
  entries: [{ binding: 0, resource: { buffer: uniformBuffer } }],
});

const pos = new Vector3(0, 0, 0);
const rot = new Vector3(0, -Math.PI / 2, 0);
const scale = new Vector3(1, 1, 1);
const camPos = new Vector3(0, 0, -2.5);
const lightDir = new Vector3(0, -1, 1).normalize();
const aspectRatio = canvas.width / canvas.height;
let orthoSize = 1.5;

const renderModes = {
  normalMapped: 0,
  textured: 1,
  smooth: 2,
  flat: 3,
} as const;

const getRenderSettings = () => {
  let shading = shadingDd.value;
  const hasTexAndUVs = model.uvs.length > 0;

  if (
    !hasTexAndUVs &&
    (shading.includes("textured") || shading.includes("normalMapped"))
  ) {
    shading = "smooth";
    shadingDd.value = shading;
  }

  if (shading === "normalMapped-shadows") {
    return {
      mode: renderModes.normalMapped,
      useShadows: true,
      isWireframe: false,
    };
  }
  if (shading === "normalMapped") {
    return {
      mode: renderModes.normalMapped,
      useShadows: false,
      isWireframe: false,
    };
  }
  if (shading === "textured") {
    return { mode: renderModes.textured, useShadows: false, isWireframe: false };
  }
  if (shading === "smooth") {
    return { mode: renderModes.smooth, useShadows: false, isWireframe: false };
  }
  if (shading === "flat") {
    return { mode: renderModes.flat, useShadows: false, isWireframe: false };
  }

  return { mode: renderModes.smooth, useShadows: false, isWireframe: true };
};

const update = (dt: number) => {
  rot.y -= dt / 5;
};

const draw = () => {
  const renderSettings = getRenderSettings();
  const modelMat = Matrix4.TRS(pos, rot, scale);
  const lightViewMat = Matrix4.LookTo(lightDir.scale(-5), lightDir, Vector3.Up);
  const lightProjMat = Matrix4.Ortho(orthoSize, aspectRatio);
  const lightSpaceMat = modelMat.multiply(lightViewMat.multiply(lightProjMat));
  const invModelMat = modelMat.invert();
  const viewMat = Matrix4.LookTo(camPos, Vector3.Forward, Vector3.Up);
  const normalMat = modelMat.invert().transpose();
  const projMat = orthographicCb.checked
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mLightDir = invModelMat.multiplyDirection(lightDir).normalize();
  const mCamPos = invModelMat.multiplyPoint(camPos).xyz;

  uniforms.set(modelMat.toArray(), 0);
  uniforms.set(viewMat.toArray(), 16);
  uniforms.set(projMat.toArray(), 32);
  uniforms.set(normalMat.toArray(), 48);
  uniforms.set(lightSpaceMat.toArray(), 64);
  uniforms.set(camPos.toArray(), 80);
  uniforms.set(lightDir.toArray(), 84);
  uniforms.set(mLightDir.toArray(), 88);
  uniforms.set(mCamPos.toArray(), 92);
  uniforms.set(
    [renderSettings.mode, renderSettings.useShadows ? 1 : 0, 0, 0],
    96,
  );
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);

  const encoder = device.createCommandEncoder();

  if (renderSettings.useShadows) {
    const shadowPass = encoder.beginRenderPass({
      colorAttachments: [],
      depthStencilAttachment: {
        view: shadowDepthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });
    shadowPass.setPipeline(shadowPipeline);
    shadowPass.setBindGroup(0, shadowBindGroup);
    shadowPass.setVertexBuffer(0, vertexBuffer);
    shadowPass.draw(model.vertices.length);
    shadowPass.end();
  }

  if (renderSettings.isWireframe) {
    const wirePass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
    });
    wirePass.setPipeline(wireframePipeline);
    wirePass.setBindGroup(0, wireframeBindGroup);
    wirePass.setVertexBuffer(0, wireframeVertexBuffer);
    wirePass.draw(wireframeVertexCount);
    wirePass.end();
  } else {
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: ctx.getCurrentTexture().createView(),
          clearValue: [0, 0, 0, 1],
          loadOp: "clear",
          storeOp: "store",
        },
      ],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });

    pass.setPipeline(pipeline);
    pass.setBindGroup(0, uniformBindGroup);
    pass.setVertexBuffer(0, vertexBuffer);
    pass.draw(model.vertices.length);
    pass.end();
  }

  const commandBuffer = encoder.finish();
  device.queue.submit([commandBuffer]);
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const deltaTime = (now - prevTime) / 1000;
  prevTime = now;
  update(deltaTime);
  draw();
  const actualFrameTime = performance.now() - now;
  fpsText.innerText = actualFrameTime.toFixed(1);
  requestAnimationFrame(loop);
};

canvas.onmousemove = (e) => {
  if (e.buttons === 1) {
    // left mouse button
    rot.y -= e.movementX / 250;
    rot.x += e.movementY / 250;
  } else if (e.buttons === 2 || e.buttons === 4) {
    // right mouse button
    pos.x += e.movementX / 250;
    pos.y -= e.movementY / 250;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  if (orthographicCb.checked) {
    orthoSize += e.deltaY / 100;
    orthoSize = Math.max(0.01, orthoSize);
  } else {
    camPos.z -= e.deltaY / 100;
  }
};

canvas.oncontextmenu = (e) => e.preventDefault();

loop();
