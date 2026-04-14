import { defineConfig } from "vite";

export default defineConfig(({ command }) => {
  if (command === "build") {
    return {
      build: {
        target: "esnext",
      },
      base: process.env.PAGES_BASE ?? "/js-renderer/",
    };
  }

  return {};
});
