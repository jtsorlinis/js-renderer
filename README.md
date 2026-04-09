# TypeScript CPU Software Renderer

![dragon](https://github.com/user-attachments/assets/ad8a7763-dd85-4db3-a9e3-392182bf8490)


**Experience it here: [jtsorlinis.github.io/js-renderer](https://jtsorlinis.github.io/js-renderer/)**

This project introduces a pure TypeScript rendering engine designed for 3D rendering directly in the browser, all without reliance on WebGL or similar hardware-accelerated APIs.

I developed this engine to deepen my understanding of rasterisation, rendering, and the fundamental workings of GPUs.

Initially, I considered using scanline rasterisation, given its potential efficiency in single-threaded CPU scenarios. However, I ultimately chose edge equations. This approach aligns more closely with methods used by actual GPUs and is easier to understand.

As a companion to this renderer, I've created a tutorial on rasterisation, which includes some of the techniques used in this engine: [jtsorlinis.github.io/rendering-tutorial](https://jtsorlinis.github.io/rendering-tutorial/)

## Run Locally

```bash
npm install
npm run dev
```

Then open the local Vite URL, usually `http://localhost:5173`.

## Features

- CPU-only software rasterizer written in TypeScript
- Wireframe rendering
- Perspective and Orthographic projection
- Basic frustum and backface culling
- Vertex attribute interpolation
- Texture and Normal mapping (Excludes filtering to prioritize speed)
- Shadow mapping
- Physically based rendering (PBR)
- Image based lighting (IBL)
- Multiple built-in demo models
- Custom `.glb` loading
- Interactive rotate, pan, and zoom controls
