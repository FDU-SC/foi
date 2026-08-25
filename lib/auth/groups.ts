import { z } from "zod";
import { enrollmentModules } from "@/content/enrollment-modules";
import { CAPABILITIES, IMPLIES, type Capability } from "./policy";

/**
 * What a group is allowed to do.
 *
 * There used to be two parallel ways to sort people, and they could not be
 * used for each other's job. `role` came from `lib/auth/policy.ts`, carried
 * capabilities, and could only be handed out by naming somebody — one role per
 * person. `tags` came from an address regex, cost nothing to add, covered a
 * whole intake at once, and conferred no privilege whatsoever. So the thing
 * that could classify had no power, and the thing that had power could not
 * classify.
 *
 * There is now one concept. A group is a name; a group *declared here* also
 * carries capabilities. Everything else about it is the same either way, and a
 * person belongs to as many as apply.
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
   * `lib/enrollment/registry.ts` refuses to let a pattern confer one. That is
   * the safety property the old role/tag split existed to provide, kept as a
   * check rather than as a structural accident.
   */
  capabilities: z.array(z.enum(CAPABILITIES)).default([]),
});

export type GroupInput = z.input<typeof groupSchema>;
export type Group = z.infer<typeof groupSchema> & { name: string };

function buildRegistry(): Map<string, Group> {
  const registry = new Map<string, Group>();
  const sources = new Map<string, string>();

  for (const path of Object.keys(enrollmentModules).sort()) {
    const exported = (enrollmentModules[path] as { groups?: unknown }).groups;
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
 * There were two spellings of this and they were the same invariant written
 * twice: `lib/enrollment/registry.ts` asked `groups.filter(isPrivileged)` at
 * load, while the suspension guard asked `capabilitiesOf(groups).size > 0`.
 * They agree — the closure over `IMPLIES` only ever adds to a set that already
 * had something in it, so it cannot turn an unprivileged membership into a
 * privileged one — but that agreement is a small proof rather than something
 * you can see, and it is the kind that stops holding the moment somebody makes
 * a capability implied by nothing.
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
 * Checked over the whole table, once, at load. It used to be checked inside
 * the loop below, which had two things wrong with it that a reader would not
 * notice: the branch could only be reached by somebody who *held* the
 * offending capability, so a two-hop entry could ship and sit silent until the
 * first administrator signed in; and it excused itself under
 * `NODE_ENV === "production"`, which is every deployed environment there is,
 * so the check that was meant to catch it ran only on a laptop.
 *
 * Both are the same mistake — asking a question about a constant at the moment
 * somebody happens to touch it — and the answer is the one `content/` gets
 * everywhere else in this codebase: refuse at load. A build whose capability
 * table has stopped closing now fails to boot, which is the loudest and
 * earliest this can be said.
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
