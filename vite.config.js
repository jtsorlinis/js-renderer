import { defineConfig } from "vite";

// The multithreaded renderer shares memory between workers (SharedArrayBuffer), which browsers
// only allow on cross-origin isolated pages. GitHub Pages can't send these headers, so the built
// site gets them from public/coi-serviceworker.js instead.
const crossOriginIsolation = {
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
};

export default defineConfig(({ command }) => {
  if (command === "build") {
    return {
      build: {
        target: "esnext",
      },
      base: process.env.PAGES_BASE ?? "/js-renderer/",
    };
  }

  return {
    server: { headers: crossOriginIsolation },
    preview: { headers: crossOriginIsolation },
  };
});
