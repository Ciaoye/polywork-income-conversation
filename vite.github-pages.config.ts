import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const repositoryName = process.env.GITHUB_REPOSITORY?.split("/").pop() || "polywork-income-conversation";

export default defineConfig({
  root: "cloudbase-web",
  base: `/${repositoryName}/`,
  publicDir: "../public",
  define: {
    "import.meta.env.VITE_POLYWORK_API_URL": JSON.stringify("https://agent2026-d5goi0noda51a261b.service.tcloudbase.com/polywork-api"),
    "import.meta.env.VITE_POLYWORK_DEFAULT_PARTICIPANT_MODE": JSON.stringify("live"),
  },
  plugins: [react()],
  build: {
    outDir: "../github-pages-dist",
    emptyOutDir: true,
  },
});
