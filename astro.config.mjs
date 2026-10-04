import { defineConfig } from "astro/config";
import sitemap from "@astrojs/sitemap";

export default defineConfig({
  site: process.env.SITE_URL ?? "https://wiki-trends.pages.dev",
  srcDir: "./site/src",
  publicDir: "./site/public",
  outDir: "./dist",
  trailingSlash: "always",
  integrations: [sitemap()],
});
