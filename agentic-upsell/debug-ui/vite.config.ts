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
    // Docker Desktop on Windows doesn't deliver native file-change events across the bind mount
    // (agentic-upsell/debug-ui -> /ui), so Vite never notices an edit and keeps serving its old
    // transform. Polling instead makes it actually pick up changes.
    watch: { usePolling: true, interval: 300 },
    proxy: {
      "/api": { target, changeOrigin: true, rewrite: (path) => path.replace(/^\/api/, "") },
    },
  },
});
