import "../style.css";
import shader from "./shader.wgsl?raw";
import shadowShader from "./shadow.wgsl?raw";
import wireframeShader from "./wireframe.wgsl?raw";
import { loadObj } from "../utils/objLoader";
import head from "../models/head.obj?raw";
import headDiffuse from "../models/head_diffuse.png";
import headNormal from "../models/head_normal_t.png";
import { Matrix4, Vector3 } from "../maths";
import { resolveShadingSelection } from "../renderSettings";

const MODEL_VERTEX_STRIDE = 15;
const MODEL_VERTEX_STRIDE_BYTES = MODEL_VERTEX_STRIDE * Float32Array.BYTES_PER_ELEMENT;
const WIREFRAME_VERTEX_STRIDE = 4;
const WIREFRAME_VERTEX_STRIDE_BYTES =
  WIREFRAME_VERTEX_STRIDE * Float32Array.BYTES_PER_ELEMENT;
const UNIFORM_FLOATS = (16 + 5) * 4;
const ROTATION_SPEED = 5;
const ROTATE_SENSITIVITY = 250;
const PAN_SENSITIVITY = 250;
const ZOOM_SENSITIVITY = 100;

const U = {
  model: 0,
  mvp: 16,
  normal: 32,
  lightMvp: 48,
  camPos: 64,
  lightDir: 68,
  modelLightDir: 72,
  modelCamPos: 76,
  settings: 80,
} as const;

const renderModes = {
  normalMapped: 0,
  textured: 1,
  smooth: 2,
  flat: 3,
} as const;

type RenderSettings = {
  mode: (typeof renderModes)[keyof typeof renderModes];
  useShadows: boolean;
  wireframe: boolean;
};

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

const loadTextureFromImage = async (src: string) => {
  const image = new Image();
  image.src = src;
  await image.decode();

  const source = await createImageBitmap(image, {
    colorSpaceConversion: "none",
  });

  const texture = device.createTexture({
    format: "rgba8unorm",
    size: [source.width, source.height],
    usage:
      GPUTextureUsage.COPY_DST |
      GPUTextureUsage.TEXTURE_BINDING |
      GPUTextureUsage.RENDER_ATTACHMENT,
  });

  device.queue.copyExternalImageToTexture(
    { source, flipY: true },
    { texture },
    { width: source.width, height: source.height },
  );

  return texture;
};

const createDepthTexture = (usage: GPUTextureUsageFlags) => {
  return device.createTexture({
    size: {
      width: canvas.width,
      height: canvas.height,
    },
    format: "depth24plus",
    usage,
  });
};

const [diffuseTexture, normalTexture] = await Promise.all([
  loadTextureFromImage(headDiffuse),
  loadTextureFromImage(headNormal),
]);

const sampler = device.createSampler({
  magFilter: "nearest",
  minFilter: "nearest",
});

const shaderModule = device.createShaderModule({ code: shader });
const shadowModule = device.createShaderModule({ code: shadowShader });
const wireframeModule = device.createShaderModule({ code: wireframeShader });

const model = loadObj(head);
trisText.innerText = (model.vertices.length / 3).toFixed(0);

const modelVertexData = new Float32Array(model.vertices.length * MODEL_VERTEX_STRIDE);
for (let i = 0; i < model.vertices.length; i++) {
  modelVertexData.set(model.vertices[i].extend(1).toArray(), i * MODEL_VERTEX_STRIDE);
  modelVertexData.set(model.normals[i].toArray(), i * MODEL_VERTEX_STRIDE + 4);
  modelVertexData.set(model.uvs[i].toArray(), i * MODEL_VERTEX_STRIDE + 7);
  modelVertexData.set(model.tangents[i].toArray(), i * MODEL_VERTEX_STRIDE + 9);
  modelVertexData.set(model.bitangents[i].toArray(), i * MODEL_VERTEX_STRIDE + 12);
}

const wireframeVertexCount = (model.vertices.length / 3) * 6;
const wireframeVertexData = new Float32Array(
  wireframeVertexCount * WIREFRAME_VERTEX_STRIDE,
);

let wireframeOffset = 0;
const pushWireframeVertex = (vertexIndex: number) => {
  wireframeVertexData.set(
    model.vertices[vertexIndex].extend(1).toArray(),
    wireframeOffset,
  );
  wireframeOffset += WIREFRAME_VERTEX_STRIDE;
};

for (let i = 0; i < model.vertices.length; i += 3) {
  pushWireframeVertex(i);
  pushWireframeVertex(i + 1);
  pushWireframeVertex(i + 1);
  pushWireframeVertex(i + 2);
  pushWireframeVertex(i + 2);
  pushWireframeVertex(i);
}

const vertexBuffer = device.createBuffer({
  size: modelVertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(vertexBuffer, 0, modelVertexData);

const wireframeVertexBuffer = device.createBuffer({
  size: wireframeVertexData.byteLength,
  usage: GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST,
});
device.queue.writeBuffer(wireframeVertexBuffer, 0, wireframeVertexData);

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
        arrayStride: MODEL_VERTEX_STRIDE_BYTES,
        attributes: [{ shaderLocation: 0, offset: 0, format: "float32x4" }],
      },
    ],
  },
});

const pipeline = device.createRenderPipeline({
  layout: "auto",
  depthStencil: {
    format: "depth24plus",
    depthWriteEnabled: true,
    depthCompare: "less",
  },
  vertex: {
    module: shaderModule,
    entryPoint: "vertex",
    buffers: [
      {
        arrayStride: MODEL_VERTEX_STRIDE_BYTES,
        attributes: [
          { shaderLocation: 0, offset: 0, format: "float32x4" },
          { shaderLocation: 1, offset: 16, format: "float32x3" },
          { shaderLocation: 2, offset: 28, format: "float32x2" },
          { shaderLocation: 3, offset: 36, format: "float32x3" },
          { shaderLocation: 4, offset: 48, format: "float32x3" },
        ],
      },
    ],
  },
  fragment: {
    module: shaderModule,
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
        arrayStride: WIREFRAME_VERTEX_STRIDE_BYTES,
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

const depthTexture = createDepthTexture(GPUTextureUsage.RENDER_ATTACHMENT);
const shadowDepthTexture = createDepthTexture(
  GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
);

const uniforms = new Float32Array(UNIFORM_FLOATS);
const uniformBuffer = device.createBuffer({
  size: uniforms.byteLength,
  usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
});

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

const getRenderSettings = (): RenderSettings => {
  const selection = resolveShadingSelection(shadingDd.value, model.uvs.length > 0);
  if (selection.normalizedValue !== shadingDd.value) {
    shadingDd.value = selection.normalizedValue;
  }
  return {
    mode: renderModes[selection.material],
    useShadows: selection.useShadows,
    wireframe: selection.wireframe,
  };
};

const update = (dt: number) => {
  rot.y -= dt / ROTATION_SPEED;
};

const draw = () => {
  const renderSettings = getRenderSettings();

  const modelMat = Matrix4.TRS(pos, rot, scale);
  const lightViewMat = Matrix4.LookTo(lightDir.scale(-5), lightDir, Vector3.Up);
  const lightProjMat = Matrix4.Ortho(orthoSize, aspectRatio);
  const lightSpaceMat = modelMat.multiply(lightViewMat.multiply(lightProjMat));
  const invModelMat = modelMat.invert();
  const viewMat = Matrix4.LookTo(camPos, Vector3.Forward, Vector3.Up);
  const projMat = orthographicCb.checked
    ? Matrix4.Ortho(orthoSize, aspectRatio)
    : Matrix4.Perspective(60, aspectRatio);
  const mvp = modelMat.multiply(viewMat).multiply(projMat);
  const normalMat = modelMat.invert().transpose();
  const mLightDir = invModelMat.multiplyDirection(lightDir).normalize();
  const mCamPos = invModelMat.multiplyPoint(camPos).xyz;

  uniforms.set(modelMat.toArray(), U.model);
  uniforms.set(mvp.toArray(), U.mvp);
  uniforms.set(normalMat.toArray(), U.normal);
  uniforms.set(lightSpaceMat.toArray(), U.lightMvp);
  uniforms.set(camPos.toArray(), U.camPos);
  uniforms.set(lightDir.toArray(), U.lightDir);
  uniforms.set(mLightDir.toArray(), U.modelLightDir);
  uniforms.set(mCamPos.toArray(), U.modelCamPos);
  uniforms.set(
    [renderSettings.mode, renderSettings.useShadows ? 1 : 0, 0, 0],
    U.settings,
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

  const colorAttachment: GPURenderPassColorAttachment = {
    view: ctx.getCurrentTexture().createView(),
    clearValue: [0, 0, 0, 1],
    loadOp: "clear",
    storeOp: "store",
  };

  if (renderSettings.wireframe) {
    const wireframePass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
    });
    wireframePass.setPipeline(wireframePipeline);
    wireframePass.setBindGroup(0, wireframeBindGroup);
    wireframePass.setVertexBuffer(0, wireframeVertexBuffer);
    wireframePass.draw(wireframeVertexCount);
    wireframePass.end();
  } else {
    const mainPass = encoder.beginRenderPass({
      colorAttachments: [colorAttachment],
      depthStencilAttachment: {
        view: depthTexture.createView(),
        depthLoadOp: "clear",
        depthStoreOp: "store",
        depthClearValue: 1.0,
      },
    });
    mainPass.setPipeline(pipeline);
    mainPass.setBindGroup(0, uniformBindGroup);
    mainPass.setVertexBuffer(0, vertexBuffer);
    mainPass.draw(model.vertices.length);
    mainPass.end();
  }

  device.queue.submit([encoder.finish()]);
};

let prevTime = 0;
const loop = () => {
  const now = performance.now();
  const deltaTime = (now - prevTime) / 1000;
  prevTime = now;
  update(deltaTime);
  draw();
  fpsText.innerText = (performance.now() - now).toFixed(1);
  requestAnimationFrame(loop);
};

canvas.onmousemove = (e) => {
  if (e.buttons === 1) {
    rot.y -= e.movementX / ROTATE_SENSITIVITY;
    rot.x += e.movementY / ROTATE_SENSITIVITY;
  } else if (e.buttons === 2 || e.buttons === 4) {
    pos.x += e.movementX / PAN_SENSITIVITY;
    pos.y -= e.movementY / PAN_SENSITIVITY;
  }
};

canvas.onwheel = (e) => {
  e.preventDefault();
  if (orthographicCb.checked) {
    orthoSize += e.deltaY / ZOOM_SENSITIVITY;
    orthoSize = Math.max(0.01, orthoSize);
  } else {
    camPos.z -= e.deltaY / ZOOM_SENSITIVITY;
  }
};

canvas.oncontextmenu = (e) => e.preventDefault();

loop();
