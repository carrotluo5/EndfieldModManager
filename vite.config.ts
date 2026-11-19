import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
  build: {
    rollupOptions: {
      input: {
        main: resolve(__dirname, "index.html"),
        overlay: resolve(__dirname, "overlay.html"),
        sidePanel: resolve(__dirname, "side-panel.html"),
      },
      output: {
        manualChunks(id) {
          if (id.includes("node_modules")) {
            if (id.includes("react-dom") || id.includes("\\react\\") || id.includes("/react/")) {
              return "vendor-react";
            }
            if (id.includes("motion") || id.includes("framer-motion")) {
              return "vendor-motion";
            }
            if (id.includes("@dnd-kit")) {
              return "vendor-dnd";
            }
            if (id.includes("pinyin-pro")) {
              return "vendor-pinyin";
            }
            if (id.includes("lucide-react")) {
              return "vendor-icons";
            }
          }
          return undefined;
        },
      },
    },
  },
});
