import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "cloudbase-web",
  base: "/polywork/",
  publicDir: "../public",
  define: {
    "import.meta.env.VITE_POLYWORK_API_URL": JSON.stringify("https://agent2026-d5goi0noda51a261b.service.tcloudbase.com/polywork-api"),
    "import.meta.env.VITE_POLYWORK_DEFAULT_PARTICIPANT_MODE": JSON.stringify("live"),
  },
  plugins: [react()],
  build: {
    outDir: "../cloudbase-dist",
    emptyOutDir: true,
  },
});
