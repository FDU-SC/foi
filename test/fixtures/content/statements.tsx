import type { MDXComponents } from "mdx/types";
import type { ReactNode } from "react";

/**
 * The components a fixture statement may name without importing them.
 *
 * Defined here rather than imported from the sample's `_shared/` library: the
 * fixture is a content set in its own right, and a kernel test that asserted a
 * component name from the sample would be asserting a deployment's vocabulary.
 */
export const statementComponents: MDXComponents = {
  Box: ({ children }: { children?: ReactNode }) => <div>{children}</div>,
};
