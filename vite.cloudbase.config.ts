import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  root: "cloudbase-web",
  base: "/polywork/",
  plugins: [react()],
  build: {
    outDir: "../cloudbase-dist",
    emptyOutDir: true,
  },
});
