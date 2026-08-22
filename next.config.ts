import createMDX from "@next/mdx";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // Emits .next/standalone with only the traced runtime files, so the
  // production image does not need node_modules or a package manager.
  output: "standalone",
};

// Turbopack cannot receive JS functions across the Rust boundary, so every
// remark/rehype plugin must be named by string with serialisable options only.
const withMDX = createMDX({
  options: {
    remarkPlugins: ["remark-gfm", "remark-math"],
    rehypePlugins: [
      "rehype-slug",
      ["rehype-katex", { strict: false, output: "html" }],
      [
        "rehype-pretty-code",
        {
          theme: { light: "github-light", dark: "github-dark-dimmed" },
          keepBackground: false,
        },
      ],
    ],
  },
});

export default withMDX(nextConfig);
