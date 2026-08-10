// Конфигурация Vite для демо-примера и сборки библиотеки
import { defineConfig } from "vite";
import { resolve } from "path";

export default defineConfig({
  root: "examples/demo",
  publicDir: "../../public",
  build: {
    outDir: "../../dist-demo",
    emptyOutDir: true,
    rollupOptions: {
      input: resolve(__dirname, "examples/demo/index.html"),
    },
  },
  server: {
    port: 5174,
    open: true,
  },
  resolve: {
    alias: {
      skinviewengine: resolve(__dirname, "src"),
    },
  },
});
