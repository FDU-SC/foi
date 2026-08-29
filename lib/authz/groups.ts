import { z } from "zod";
import { enrollmentSources } from "@/lib/enrollment/modules";

/**
 * A group is a label, nothing more.
 *
 * Groups carry no permissions: what a member of a group may do is decided by
 * the policies in `content/policies/` that name it. Declaring a group here only
 * gives it a display name and a description — a group used purely as an
 * audience or a participant set does not have to be declared at all.
 */
const groupSchema = z.object({
  id: z.string().min(1).max(64),
  name: z.string().min(1).max(64).optional(),
  description: z.string().max(200).optional(),
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
          .map(
            (issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
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

export function listGroups(): Group[] {
  return [...registry.values()].sort((a, b) => a.id.localeCompare(b.id));
}

export function declaredGroupIds(): string[] {
  return [...registry.keys()];
}

export function groupName(id: string): string {
  return registry.get(id)?.name ?? id;
}
