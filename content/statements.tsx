import type { MDXComponents } from "mdx/types";
import { Callout } from "@/content/_shared/mdx/callout";
import { Constraints } from "@/content/_shared/mdx/constraints";
import { Sample } from "@/content/_shared/mdx/sample";
import { CodeInput } from "@/content/_shared/ui/code-input";
import { FlagInput } from "@/content/_shared/ui/flag-input";
import { SubmitPanel } from "@/content/_shared/ui/submit-panel";
import { TextInput } from "@/content/_shared/ui/text-input";

/**
 * The components an authored statement may use, by name and without importing
 * them.
 *
 * A repository statement writes `import { Callout } from "…"` at its top and the
 * bundler resolves it. An authored one is text in the database: there is nothing
 * to resolve an import against at request time, so the platform hands this set
 * to the MDX compiler instead and the two write the same JSX.
 *
 * The list is closed on purpose. There is no registration point for a new
 * component, because a statement that needed one would be a new page rather than
 * new copy. KaTeX, GFM tables and syntax-highlighted fences come from the
 * compiler's own plugin set and need no component here.
 */
export const statementComponents: MDXComponents = {
  Callout,
  Constraints,
  Sample,
  SubmitPanel,
  CodeInput,
  TextInput,
  FlagInput,
};
