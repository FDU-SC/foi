import { external, gated, inline, late } from "../problems";

/**
 * Keys mimic what `import.meta.glob` hands the registry, because the registry
 * parses the slug back out of them. The fixture declares the table by hand so
 * the kernel tests never depend on a deployment's files being discoverable.
 */
export const problemConfigModules = {
  "./problems/fixture-external/problem.ts": { problem: external },
  "./problems/fixture-inline/problem.ts": { problem: inline },
  "./problems/fixture-gated/problem.ts": { problem: gated },
  "./problems/fixture-late/problem.ts": { problem: late },
};

/** Inline judges are declared on the problems themselves, so nothing to merge. */
export const problemJudgeModules = {};

export const problemStatementModules = {
  "./problems/fixture-external/statement.mdx": () =>
    Promise.resolve({ default: () => null }),
  "./problems/fixture-inline/statement.mdx": () =>
    Promise.resolve({ default: () => null }),
  "./problems/fixture-gated/statement.mdx": () =>
    Promise.resolve({ default: () => null }),
  "./problems/fixture-late/statement.mdx": () =>
    Promise.resolve({ default: () => null }),
};
