import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// The UI calls /api/dev/*; Vite forwards it to the AI service's /dev/*.
// In Docker the target is the ai-api container; locally it's port 8100.
const target = process.env.API_PROXY_TARGET ?? "http://localhost:8100";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: {
      "/api": { target, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
});
