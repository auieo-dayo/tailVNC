import { defineConfig } from "vite";

export default defineConfig({
  esbuild: {
    target: "esnext",
  },
  optimizeDeps: {
    esbuildOptions: {
      target: "esnext",
    },
  },
  build: {
    target: "esnext",
  },
  server: {
    host: "0.0.0.0",
  },
});