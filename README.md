# TypeScript CPU Software Renderer

**Experience it here: https://jtsorlinis.github.io/js-renderer/**

This project introduces a pure TypeScript rendering engine designed for 3D rendering directly in the browser, all without reliance on WebGL or similar hardware-accelerated APIs.

I developed this engine to deepen my understanding of rasterisation, rendering, and the fundamental workings of GPUs.

Initially, I considered using scanline rasterisation, given its potential efficiency in single-threaded CPU scenarios. However, I ultimately chose edge equations. This approach aligns more closely with methods used by actual GPUs and is easier to understand.

As a companion to this renderer, I've created a tutorial on rasterisation, which includes some of the techniques used in this engine: https://jtsorlinis.github.io/rendering-tutorial/

## Features
- Wireframe rendering
- Perspective and Orthographic projection
- Vertex attribute interpolation
- Texture and Normal mapping (Excludes filtering to prioritize speed)
- Shadow mapping
- OBJ model loading
- Basic frustum and backface culling
