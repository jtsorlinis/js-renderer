# TypeScript CPU Software Renderer

<img width="1720" height="1287" alt="image" src="https://github.com/user-attachments/assets/3a675256-0883-4035-bdba-e11a637b72d0" />



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
- Optional multithreaded rendering with Web Workers

## Multithreaded Rendering

The **Multithreaded** checkbox (on by default) splits each frame across Web Workers and renders at 1600x1200 instead of 800x600. It's an optional layer on top of the renderer: everything it adds lives in `src/workers/`, and the workers draw with the same `triangle()`, `line()` and shaders as the single-threaded path. If you're here to learn how the rasteriser works, start with `draw()` in `src/main.ts` and `src/drawing/`, and come back to this later.

It works a bit like the tile-based GPUs in most phones:

1. The frame is cut into thin full-width bands.
2. The main thread works out which bands each triangle touches (binning) and renders the shadow map once.
3. Each worker takes the next free band from a shared counter, so a worker on a slower core just ends up drawing fewer bands.
4. A band is drawn into its own small framebuffer. After the perspective divide, `y` is remapped so the band fills the whole -1 to 1 range, which lets the unmodified `triangle()` and `line()` draw into it as if it were a full frame. `x` stays the same because bands are full width.
5. Each band is copied into one shared frame, which is then put on the canvas.

The files:

- `src/workers/TiledWorkerRenderer.ts`: main thread. Splits the frame into bands, bins triangles, renders the shadow pass and starts the workers.
- `src/workers/renderWorker.ts`: draws bands until none are left.
- `src/workers/renderProtocol.ts`: the messages between them. The scene is packed into typed arrays in shared memory, so every worker reads the same copy.

Sharing memory between workers needs `SharedArrayBuffer`, which browsers only allow on cross-origin isolated pages (served with `Cross-Origin-Opener-Policy` and `Cross-Origin-Embedder-Policy` headers). `npm run dev` and `npm run preview` send these headers (see `vite.config.js`). GitHub Pages can't set headers, so the deployed site uses [coi-serviceworker](https://github.com/gzuidhof/coi-serviceworker) (`public/coi-serviceworker.js`), a small service worker that adds them. On a first visit it installs itself and reloads the page once. Where cross-origin isolation isn't available, the checkbox is disabled and the single-threaded renderer is used.
