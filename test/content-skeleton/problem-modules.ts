import "server-only";

/**
 * Not content. This declares where the server/client boundary runs.
 *
 * Everything else under `content/` is a deployment's to edit; the
 * `*-modules.ts` files beside this one are the kernel's, and editing one moves
 * a boundary rather than changing a round. They live here because
 * `import.meta.glob`
 * only scans downward from the calling file — `../`, the `@/` alias and a
 * leading `/` all resolve to nothing — so the globs have to sit next to what
 * they scan, and the registries under `lib/` consume the results.
 *
 * `server-only` is what makes the boundary hold. A problem's `backend.config`
 * routinely holds testdata locations, checker settings, or literal answers,
 * and `toPublicConfig` strips it from the *data* handed to a client component
 * — but that says nothing about the *module*. One glob file exporting all of
 * this at once meant any client component that reached `@/content` for any
 * reason pulled every problem, every statement, every enrolment rule into a
 * browser chunk. One did: `components/site/user-menu.tsx` wanted `groupName`.
 * Splitting the globs limits the blast radius; the marker below is what turns
 * a repeat into a failed build instead of a shipped answer key.
 *
 * Configs load eagerly since listing pages need all of them at once;
 * statements load lazily so a problem page pulls in only the MDX it is about
 * to render. Both graphs stay on the server.
 */
export const problemConfigModules = import.meta.glob(
  "./problems/*/problem.ts",
  { eager: true },
);

export const problemStatementModules = import.meta.glob(
  "./problems/*/statement.mdx",
);
