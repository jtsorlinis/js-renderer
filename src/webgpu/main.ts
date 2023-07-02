import "../style.css";
import shader from "./shader.wgsl?raw";
import { loadObj } from "../utils/objLoader";
import head from "../models/head.obj?raw";
import headDiffuse from "../models/head_diffuse.png";
import headNormal from "../models/head_normal_w.png";
import { Matrix4, Vector3 } from "../maths";

const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const fpsText = document.getElementById("fps") as HTMLSpanElement;

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
  { width: diffuseSource.width, height: diffuseSource.height }
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
  { width: normalSource.width, height: normalSource.height }
);

const sampler = device.createSampler({
  magFilter: "linear",
  minFilter: "linear",
});

const module = device.createShaderModule({
  code: shader,
});

// Load model
const vertexStride = 10;
const model = loadObj(head);
const vertexData = new Float32Array(model.vertices.length * vertexStride);

for (let i = 0; i < model.vertices.length; i++) {
  vertexData.set(model.vertices[i].extend(1).toArray(), i * vertexStride);
  vertexData.set(model.normals[i].toArray(), i * vertexStride + 4);
  vertexData.set(model.uvs[i].toArray(), i * vertexStride + 7);
}

const vertexBuffer = device.createBuffer({
  size: vertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, vertexData);

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

// Create z-buffer texture
const depthTexture = device.createTexture({
  size: {
    width: canvas.width,
    height: canvas.height,
  },
  format: "depth24plus",
  usage: GPUTextureUsage.RENDER_ATTACHMENT,
});

// Create uniform buffer
const uniforms = new Float32Array((16 + 4) * 4);
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
  ],
});

const pos = new Vector3(0, 0, 0);
const rot = new Vector3(0, 3.14, 0);
const scale = new Vector3(1, 1, 1);
const camPos = new Vector3(0, 0, -2.5);
const lightDir = new Vector3(0, -1, 1);
const aspectRatio = canvas.width / canvas.height;

const update = (dt: number) => {
  rot.y -= dt / 5;
};

const draw = () => {
  const modelMat = Matrix4.TRS(pos, rot, scale);
  const invModelMat = modelMat.invert();
  const camForward = camPos.add(new Vector3(0, 0, 1));
  const viewMat = Matrix4.LookAt(camPos, camForward, Vector3.Up);
  const normalMat = modelMat.invert().transpose();
  const projMat = Matrix4.Perspective(60, aspectRatio, 0.1, 1000);
  const mLightDir = invModelMat.multiplyDirection(lightDir).normalize();
  const mCamPos = invModelMat.multiplyPoint(camPos).xyz;

  uniforms.set(modelMat.toArray(), 0);
  uniforms.set(viewMat.toArray(), 16);
  uniforms.set(projMat.toArray(), 32);
  uniforms.set(normalMat.toArray(), 48);
  uniforms.set(camPos.toArray(), 64);
  uniforms.set(mLightDir.toArray(), 68);
  uniforms.set(mCamPos.toArray(), 72);
  device.queue.writeBuffer(uniformBuffer, 0, uniforms);
  const encoder = device.createCommandEncoder();
  const textureView = ctx.getCurrentTexture().createView();

  const pass = encoder.beginRenderPass({
    colorAttachments: [
      {
        view: textureView,
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
  camPos.z -= e.deltaY / 100;
};

canvas.oncontextmenu = (e) => e.preventDefault();

loop();
