import { defineConfig } from "vite";

// When deployed to GitHub Pages at https://punjidixie.github.io/vibe-charter/,
// assets must be served from the /vibe-charter/ subpath. In dev this is "/".
export default defineConfig({
  base: process.env.GITHUB_PAGES === "true" ? "/vibe-charter/" : "/",
  server: { open: true },
  build: { target: "es2022" },
});
