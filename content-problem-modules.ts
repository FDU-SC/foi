import "server-only";

/**
 * Not content. This declares where the server/client boundary runs.
 *
 * Everything under `content/` is a deployment's to edit; the eight
 * `content-*-modules.ts` files at the repository root are the kernel's, and
 * editing one moves a boundary rather than changing a round. They sit at the
 * root, beside `instrumentation.ts` and `mdx-components.tsx`, for two reasons
 * that pull in the same direction.
 *
 * The first is mechanical: `import.meta.glob` only scans downward from the
 * calling file — `../`, the `@/` alias and a leading `/` all resolve to
 * nothing — so a glob has to sit at or above what it scans. The root is the
 * nearest place that qualifies.
 *
 * The second is the point of the exercise. These files used to live *inside*
 * `content/`, which made the claim "the platform is a thin kernel and content
 * is replaceable" untestable at its strongest form: `rm -rf content` took the
 * boundary declarations with it and the build failed at module resolution,
 * long before anything interesting could be learned. It also forced
 * `test/content-skeleton/` to carry byte-identical copies of all eight, two
 * declarations of one boundary that could drift in silence. From the root they
 * survive the directory they scan, so a deployment can delete `content/`
 * outright and the kernel still compiles, boots and serves — see the
 * `content-absent` job in `.github/workflows/check.yml`, which is that
 * sentence as a check rather than as a comment.
 *
 * A glob whose directory does not exist yields `{}` rather than an error, and
 * every registry under `lib/` treats an empty result as a legal deployment.
 *
 * `server-only` is what makes the boundary hold. A problem's `backend.config`
 * routinely holds testdata locations, checker settings, or literal answers,
 * and `toPublicConfig` strips it from the *data* handed to a client component
 * — but that says nothing about the *module*. One glob file exporting all of
 * this at once meant any client component that reached for any of it pulled
 * every problem, every statement, every enrolment rule into a browser chunk.
 * One did: `components/site/user-menu.tsx` wanted `groupName`. Splitting the
 * globs limits the blast radius; the marker below is what turns a repeat into
 * a failed build instead of a shipped answer key.
 *
 * Configs load eagerly since listing pages need all of them at once;
 * statements load lazily so a problem page pulls in only the MDX it is about
 * to render. Both graphs stay on the server.
 */
export const problemConfigModules = import.meta.glob(
  "./content/problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./content/problems/*/statement.mdx",
);
