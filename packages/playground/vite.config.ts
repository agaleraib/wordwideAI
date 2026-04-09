import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Dev server runs on 5174 to avoid clashing with the archived web mockup at 5173.
// /poc/* is proxied to the api dev server on port 3099 by default — this
// matches `bun run dev:poc` in packages/api, which runs the api on 3099 so it
// coexists with anything else already on 3000 (e.g. gobot). Override with
// `VITE_API_PORT=X bun run dev` if you need a different target.
const apiPort = process.env["VITE_API_PORT"] ?? "3099";
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5174,
    proxy: {
      "/poc": {
        target: `http://localhost:${apiPort}`,
        changeOrigin: true,
      },
    },
  },
});
