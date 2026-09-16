import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  {
    rules: {

      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          ignoreRestSiblings: true,
        },
      ],
    },
  },
  {

    files: ["scripts/**/*.cjs"],
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },

  {
    // The root shell renders <html> and <head> because it is what the root
    // layout returns. `next/head` is Pages Router API and cannot set a class on
    // <html> before first paint, which is what the theme script is for.
    files: ["views/root-shell.tsx", "views.local/root-shell.tsx"],
    rules: { "@next/next/no-head-element": "off" },
  },

  {
    // An avatar is same-origin bytes already encoded as a small square WebP.
    // The optimizer would add a hop and re-encode what the browser produced.
    files: ["components/ui/avatar.tsx", "components.local/ui/avatar.tsx"],
    rules: { "@next/next/no-img-element": "off" },
  },

  globalIgnores([

    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
