import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    proxy: { "/api": "http://localhost:4000" },
    headers: { "Cache-Control": "no-store, no-cache, must-revalidate", "Pragma": "no-cache", "Expires": "0" },
  },
});