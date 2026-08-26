import { z } from "zod";
import { enrollmentSources } from "@/lib/enrollment/modules";
import { CAPABILITIES, IMPLIES, type Capability } from "./policy";

/**
 * What a group is allowed to do.
 *
 * One concept, not two. A group is a name; a group *declared here* also
 * carries capabilities. Everything else about it is the same either way, and a
 * person belongs to as many as apply — so the thing that classifies and the
 * thing that carries power are not separate mechanisms that cannot do each
 * other's job.
 *
 * The kernel still owns the vocabulary: `CAPABILITIES` in `./policy` is the
 * list of decisions this codebase knows how to make, because those names are
 * identifiers the code reads. What a deployment owns is which groups exist and
 * which of those decisions each one may make — that is content, and it lives
 * in `content/enrollment/`.
 */
const groupSchema = z.object({
  /** Referenced by enrollment rules and by a contest's `participants`. */
  id: z.string().min(1).max(64),
  /** Shown wherever the group is displayed. Defaults to the id. */
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(200).optional(),
  /**
   * What members may do. Omitted means nothing — an ordinary cohort.
   *
   * A group with capabilities can only be joined by a rule that names handles;
   * `lib/enrollment/registry.ts` refuses to let a pattern confer one.
   */
  capabilities: z.array(z.enum(CAPABILITIES)).default([]),
});

export type GroupInput = z.input<typeof groupSchema>;
export type Group = z.infer<typeof groupSchema> & { name: string };

function buildRegistry(): Map<string, Group> {
  const registry = new Map<string, Group>();
  const sources = new Map<string, string>();

  for (const { path, groups: exported } of enrollmentSources()) {
    if (exported === undefined) continue;

    if (!Array.isArray(exported)) {
      throw new Error(`${path} 导出的 groups 必须是数组`);
    }

    exported.forEach((raw, index) => {
      const parsed = groupSchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
          .join("\n");
        throw new Error(`${path} 第 ${index + 1} 个用户组不合法:\n${issues}`);
      }

      const existing = sources.get(parsed.data.id);
      if (existing) {
        throw new Error(
          `用户组 "${parsed.data.id}" 重复声明: ${existing} 与 ${path}`,
        );
      }
      sources.set(parsed.data.id, path);
      registry.set(parsed.data.id, {
        ...parsed.data,
        name: parsed.data.name ?? parsed.data.id,
      });
    });
  }

  return registry;
}

const registry = buildRegistry();

export function getGroup(id: string): Group | undefined {
  return registry.get(id);
}

export function listGroups(): Group[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

/** Whether this group carries any privilege, and therefore may not be inferred. */
export function isPrivileged(id: string): boolean {
  return (registry.get(id)?.capabilities.length ?? 0) > 0;
}

/**
 * The same question about a whole membership, and the only way to ask it.
 *
 * `capabilitiesOf(groups).size > 0` is the other way to spell it, and it must
 * not be spelled that way anywhere. The two agree only because the closure
 * over `IMPLIES` adds to a set that already had something in it, so it cannot
 * turn an unprivileged membership into a privileged one — a small proof rather
 * than something you can see, and one that stops holding the moment somebody
 * makes a capability implied by nothing.
 *
 * Defined over `isPrivileged` rather than beside it, so there is one place
 * that knows what "privileged" means and this only decides how many groups to
 * ask it about.
 */
export function hasPrivilege(groupIds: readonly string[]): boolean {
  return groupIds.some(isPrivileged);
}

/** Every group the repository declares, privileged or not. */
export function declaredGroupIds(): string[] {
  return [...registry.keys()];
}

export function privilegedGroupIds(): string[] {
  return listGroups()
    .filter((group) => group.capabilities.length > 0)
    .map((group) => group.id);
}

/**
 * `capabilitiesOf` walks `IMPLIES` one hop, so `IMPLIES` has to be flat.
 *
 * Checked over the whole table, once, at load, and deliberately not inside
 * `capabilitiesOf`'s loop. Checked there, the branch is only reachable by
 * somebody who *holds* the offending capability, so a two-hop entry ships and
 * sits silent until the first administrator signs in — asking a question about
 * a constant at the moment somebody happens to touch it. A build whose
 * capability table has stopped closing fails to boot instead, which is the
 * loudest and earliest this can be said.
 *
 * Exported for `./groups.test.ts`, which has to reach into `IMPLIES` to see it
 * fire at all: the repository's own table is flat, and a guard nothing can
 * demonstrate is a guard nobody can trust.
 */
export function assertFlatImplications(): void {
  for (const [capability, implied] of Object.entries(IMPLIES)) {
    for (const id of implied ?? []) {
      if (IMPLIES[id]) {
        throw new Error(
          `IMPLIES 里 "${capability}" 蕴含的 "${id}" 自己也有蕴含项，` +
            `capabilitiesOf 只走一跳，需要改成求闭包。`,
        );
      }
    }
  }
}

assertFlatImplications();

/**
 * Everything a set of memberships adds up to.
 *
 * A union, because belonging to two groups means being able to do what either
 * allows. Undeclared groups contribute nothing, which is what makes an
 * unlisted cohort name harmless.
 *
 * Then the closure over `IMPLIES`, because some of these capabilities are the
 * same decision under two names and a deployment that grants one without the
 * other gets a rule it believes in and a bypass it does not. One hop, which is
 * enough only because `assertFlatImplications` above has already refused to
 * let this module load against a table where it would not be.
 */
export function capabilitiesOf(groupIds: readonly string[]): Set<Capability> {
  const granted = new Set<Capability>();
  for (const id of groupIds) {
    for (const capability of registry.get(id)?.capabilities ?? []) {
      granted.add(capability);
    }
  }

  for (const capability of [...granted]) {
    for (const implied of IMPLIES[capability] ?? []) granted.add(implied);
  }

  return granted;
}

/** Display name, falling back to the raw id for a group nothing declares. */
export function groupName(id: string): string {
  return registry.get(id)?.name ?? id;
}
