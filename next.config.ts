import createMDX from "@next/mdx";
import type { NextConfig } from "next";

import {
  PROXY_CLIENT_MAX_BODY_SIZE,
  SERVER_ACTION_BODY_LIMIT,
} from "./lib/body-limit";

const securityHeaders = [
  {
    key: "Content-Security-Policy",
    value: [
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "object-src 'none'",
    ].join("; "),
  },

  { key: "X-Frame-Options", value: "DENY" },

  { key: "X-Content-Type-Options", value: "nosniff" },

  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },

  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],

  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT },
    proxyClientMaxBodySize: PROXY_CLIENT_MAX_BODY_SIZE,
  },

  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
};

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
