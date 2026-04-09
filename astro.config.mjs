import { defineConfig } from "astro/config";
import mdx from "@astrojs/mdx";
import sitemap from "@astrojs/sitemap";
import rehypeMermaidClient from "./plugins/rehype-mermaid-client.mjs";

import cloudflare from "@astrojs/cloudflare";

export default defineConfig({
  site: "https://rhysmurray.me",
  integrations: [mdx(), sitemap()],

  markdown: {
    rehypePlugins: [rehypeMermaidClient],
    shikiConfig: {
      theme: "github-light",
      langs: ["ruby", "erb", "html", "javascript", "bash", "yaml", "json", "sql", "css", "shell"],
    },
  },

  adapter: cloudflare(),
});