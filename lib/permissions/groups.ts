import { z } from "zod";
import { enrollmentSources } from "@/lib/enrollment/modules";
import { CAPABILITIES, IMPLIES, type Capability } from "./policy";

const groupSchema = z.object({

  id: z.string().min(1).max(64),

  name: z.string().min(1).max(64).optional(),
  description: z.string().max(200).optional(),

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

export function isPrivileged(id: string): boolean {
  return (registry.get(id)?.capabilities.length ?? 0) > 0;
}

export function hasPrivilege(groupIds: readonly string[]): boolean {
  return groupIds.some(isPrivileged);
}

export function declaredGroupIds(): string[] {
  return [...registry.keys()];
}

export function privilegedGroupIds(): string[] {
  return listGroups()
    .filter((group) => group.capabilities.length > 0)
    .map((group) => group.id);
}

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

export function groupName(id: string): string {
  return registry.get(id)?.name ?? id;
}
