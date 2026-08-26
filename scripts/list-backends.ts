/**
 * Prints the id of every backend this deployment declares, one per line.
 *
 * Exists so that nothing outside `content/` has to keep its own copy of the
 * roster. Four places did: `.env.example`, `.env.production.example`,
 * `setup-deploy.sh` and the CI smoke step each spelled out
 * `traditional / interactive / performance / leaky-bucket`, so adding a
 * backend meant remembering all four, and swapping `content/` left all four
 * describing a deployment that no longer existed.
 *
 * Reads `content/backends.ts` directly rather than going through
 * `lib/backend/registry.ts`, which is not importable from plain Node: it comes
 * by way of `content/backend-modules.ts`, and `import.meta.glob` is a bundler
 * feature that only exists under Turbopack and Vite. The file itself is an
 * ordinary module, so tsx loads it as written.
 *
 * No content, or no roster in it, means no output and exit 0 — a deployment
 * judging everything inline declares no backends, and a caller looping over
 * this output should get an empty loop rather than an error.
 */
/**
 * Deliberately a `string` rather than a literal.
 *
 * `tsc` resolves a literal import specifier at compile time, so writing the
 * path inline made `pnpm typecheck` fail the moment `content/backends.ts` was
 * gone — which is the one situation this script exists to survive, and the
 * one the `content-absent` job puts it in. Widening the type is what keeps
 * the module graph out of the type checker's reach; the `catch` below covers
 * the runtime.
 */
const SOURCE: string = "../content/backends";

async function main(): Promise<void> {
  let backends: Record<string, unknown>;

  try {
    ({ backends } = (await import(SOURCE)) as {
      backends: Record<string, unknown>;
    });
  } catch (error) {
    const code = (error as { code?: string }).code;
    if (code === "ERR_MODULE_NOT_FOUND" || code === "MODULE_NOT_FOUND") return;
    throw error;
  }

  for (const id of Object.keys(backends)) console.log(id);
}

// Not top-level `await`: there is no `"type": "module"` here, so tsx emits CJS
// and esbuild refuses it.
main().catch((error: unknown) => {
  console.error(error);
  process.exitCode = 1;
});
