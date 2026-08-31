/**
 * The slots a deployment may fill.
 *
 * Each pair is an `upstream` root this repository ships and a `local` root a
 * fork supplies. `tsconfig.json` resolves each alias to the local root first
 * and falls back per file, so a fork overrides the handful of files it cares
 * about instead of editing files the upstream owns — which is what makes every
 * upstream merge conflict-free.
 *
 * No slot exists in this repository. Resolution, the deployment test project,
 * and the source scanners all tolerate their absence.
 *
 * Plain ESM JavaScript on purpose: `vitest.config.mts` imports this, and a
 * config loaded natively cannot pull in a TypeScript module.
 */

/** @typedef {{ alias: string, upstream: string, local: string }} Slot */

/** @type {Slot[]} */
export const SLOTS = [
  { alias: "@/content", upstream: "content", local: "content.local" },
  { alias: "@/components", upstream: "components", local: "components.local" },
  { alias: "@/views", upstream: "views", local: "views.local" },
];

/** Both halves of every slot — everywhere overridable source can live. */
export const SLOT_ROOTS = SLOTS.flatMap((slot) => [slot.upstream, slot.local]);

/** The half a fork fills. */
export const LOCAL_ROOTS = SLOTS.map((slot) => slot.local);

export const CONTENT_SLOT = "content.local";

export const CONTENT_ROOTS = ["content", CONTENT_SLOT];

/**
 * Roots whose tests describe one deployment rather than the platform.
 *
 * `content/` is here because it is a sample: its tests name the problems and
 * contests this deployment happens to ship. `components/` and `views/` are
 * platform code, so their tests stay with the kernel — but their `.local`
 * halves belong to whoever wrote them, and run against real content.
 */
export const DEPLOYMENT_ROOTS = ["content", ...LOCAL_ROOTS];

/**
 * @param {string} name
 * @returns {boolean}
 */
export function isContentRoot(name) {
  return CONTENT_ROOTS.includes(name);
}
