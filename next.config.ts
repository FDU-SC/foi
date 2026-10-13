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

/**
 * How Turbopack should read a problem's judge sources.
 *
 * Turbopack has no built-in module type for `makefile`, `.cpp`, `.cu` or
 * anything else a problem ships, so without this rule every
 * `import.meta.glob("./code/*")` fails the build with "Unknown module type" —
 * including the plain extensionless `makefile`, which is the most common judge
 * file of all.
 *
 * Matched by *path* rather than by extension, so a problem may keep any file at
 * all in its `code/` — a `.toml`, a `.csv`, a script with no extension — and
 * `content/_shared/judge-files.ts` needs no list of permitted extensions to stay
 * in sync with. `code/` exists precisely to say "everything in here is a judge
 * source", and that is a property of where the file is, not what it is called.
 * A file named `weird.xyz` is read exactly like a `.cpp`.
 *
 * One rule, not a list. It matches a `code` directory at any depth under any
 * problem, and covers nested directories inside it too. (Written without the
 * literal pattern text here on purpose: a block comment cannot contain a
 * closing delimiter, and the glob itself reads as `**` + `/code/` + `**`.)
 */
const JUDGE_FILE_LOADER = {
  loaders: ["./tools/judge-file-loader.cjs"],
  as: "*.js",
};

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],

  turbopack: {
    rules: { "**/code/**": JUDGE_FILE_LOADER },
  },

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
