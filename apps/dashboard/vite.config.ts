import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [tailwindcss()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("../extension/webview/ui", import.meta.url)),
    },
    dedupe: ["react", "react-dom"],
  },
  build: { outDir: "dist/site" },
  server: { fs: { allow: [".."] } },
});
