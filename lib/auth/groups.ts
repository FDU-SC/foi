import { z } from "zod";
import { enrollmentModules } from "@/content";
import { CAPABILITIES, type Capability } from "./policy";

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
export const groupSchema = z.object({
  /** Referenced by grants, by rules, and by a contest's `participants`. */
  id: z.string().min(1).max(64),
  /** Shown wherever the group is displayed. Defaults to the id. */
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(200).optional(),
  /**
   * What members may do. Omitted means nothing — an ordinary cohort.
   *
   * A group with capabilities can only be joined by being named in `grants`;
   * `lib/enrollment/registry.ts` refuses to let a rule confer one. That is the
   * safety property the old role/tag split existed to provide, kept as a check
   * rather than as a structural accident.
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
 * Everything a set of memberships adds up to.
 *
 * A union, because belonging to two groups means being able to do what either
 * allows. Undeclared groups contribute nothing, which is what makes an
 * unlisted cohort name harmless.
 */
export function capabilitiesOf(groupIds: readonly string[]): Set<Capability> {
  const granted = new Set<Capability>();
  for (const id of groupIds) {
    for (const capability of registry.get(id)?.capabilities ?? []) {
      granted.add(capability);
    }
  }
  return granted;
}

/** Display name, falling back to the raw id for a group nothing declares. */
export function groupName(id: string): string {
  return registry.get(id)?.name ?? id;
}
