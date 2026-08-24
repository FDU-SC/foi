import createMDX from "@next/mdx";
import type { NextConfig } from "next";
// Relative rather than through the `@/` alias: this file is loaded by Next's
// own config loader, which does not read `tsconfig` paths.
import {
  PROXY_CLIENT_MAX_BODY_SIZE,
  SERVER_ACTION_BODY_LIMIT,
} from "./lib/body-limit";

/**
 * Headers every response carries, set here rather than in the Caddyfile.
 *
 * Caddy is not in this repository and is not in front of dev or staging at
 * all, so a header only written there is a header two of the three deployed
 * environments do not have — and the one that stops `/login` and `/admin` from
 * being framed is not one to leave to a file nobody reviews alongside the code.
 *
 * What is deliberately absent is `script-src`. Next inlines its own bootstrap,
 * and so does the theme script in `app/layout.tsx`, so a useful one needs a
 * per-response nonce; issuing nonces from the proxy would make every page
 * dynamic, including the statement pages that are the reason this app renders
 * statically at all. `'unsafe-inline'` would satisfy the scanner and stop
 * nothing. The directives below are the ones that hold without a nonce, and
 * each of them closes something: `frame-ancestors` clickjacking, `form-action`
 * a form posting credentials elsewhere, `base-uri` a `<base>` tag rewriting
 * every relative URL on the page.
 */
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
  // Superseded by frame-ancestors where both are understood, and still the
  // only one of the two that some older clients act on.
  { key: "X-Frame-Options", value: "DENY" },
  // Belt to the per-route braces on `/api/problems/[slug]/action/[action]`,
  // which relays a body a problem backend chose.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Password reset links carry their token in the query string, so what leaves
  // in a Referer matters. Matches what current browsers already default to,
  // said out loud so it does not depend on that staying true.
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  // Ignored over plain HTTP, which is what dev and staging serve on the
  // tailnet, so this is inert there rather than wrong. Without
  // `includeSubDomains`: this app does not own its siblings.
  { key: "Strict-Transport-Security", value: "max-age=31536000" },
];

const nextConfig: NextConfig = {
  pageExtensions: ["ts", "tsx", "mdx"],
  // Emits .next/standalone with only the traced runtime files, so the
  // production image does not need node_modules or a package manager.
  output: "standalone",
  experimental: {
    serverActions: { bodySizeLimit: SERVER_ACTION_BODY_LIMIT },
    proxyClientMaxBodySize: PROXY_CLIENT_MAX_BODY_SIZE,
  },
  // Names the framework and its major version to anyone scanning for a version
  // with a published advisory.
  poweredByHeader: false,
  headers() {
    return Promise.resolve([{ source: "/:path*", headers: securityHeaders }]);
  },
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
