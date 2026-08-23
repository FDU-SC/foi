import { rosterModules } from "@/content";
import { normalizeHandle, rosterEntrySchema, type RosterEntry } from "./types";

/**
 * The roster is discovered from the filesystem at build time, exactly like the
 * problem registry: a file under `content/roster/` is picked up with no
 * registration step, and Turbopack's watcher reloads it during `next dev`.
 *
 * Splitting the roster across several files is encouraged — one per cohort
 * reads better than one long list, and the registry merges them.
 *
 * Handles are keyed case-insensitively. Two entries differing only in case
 * would be indistinguishable to anyone reading a standings page, so the
 * registry rejects them outright rather than letting one impersonate the
 * other.
 */
function buildRegistry(): Map<string, RosterEntry> {
  const registry = new Map<string, RosterEntry>();
  const sources = new Map<string, string>();

  for (const [path, mod] of Object.entries(rosterModules)) {
    const exported = (mod as { members?: unknown }).members;
    if (exported === undefined) {
      throw new Error(`${path} 必须导出名为 members 的数组`);
    }
    if (!Array.isArray(exported)) {
      throw new Error(`${path} 导出的 members 必须是数组`);
    }

    exported.forEach((raw, index) => {
      const parsed = rosterEntrySchema.safeParse(raw);
      if (!parsed.success) {
        const issues = parsed.error.issues
          .map(
            (issue) =>
              `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`,
          )
          .join("\n");
        throw new Error(`${path} 第 ${index + 1} 条名册记录不合法:\n${issues}`);
      }

      const key = normalizeHandle(parsed.data.handle);
      const existing = sources.get(key);
      if (existing) {
        throw new Error(
          `用户名 "${parsed.data.handle}" 重复: ${existing} 与 ${path}（大小写不敏感）`,
        );
      }

      sources.set(key, path);
      registry.set(key, parsed.data);
    });
  }

  return registry;
}

const registry = buildRegistry();

/** Case-insensitive, so a handle typed with the wrong capitalisation logs in. */
export function getMember(handle: string): RosterEntry | undefined {
  return registry.get(normalizeHandle(handle));
}

export function hasMember(handle: string): boolean {
  return registry.has(normalizeHandle(handle));
}

export function listMembers(options?: {
  includeDisabled?: boolean;
}): RosterEntry[] {
  return [...registry.values()]
    .filter((member) => options?.includeDisabled || !member.disabled)
    .sort((a, b) => a.handle.localeCompare(b.handle));
}

/** Everyone carrying a given tag, used by contests to build their roster. */
export function membersWithTag(tag: string): RosterEntry[] {
  return listMembers().filter((member) => member.tags.includes(tag));
}

export function listTags(): string[] {
  const tags = new Set<string>();
  for (const member of registry.values()) {
    for (const tag of member.tags) tags.add(tag);
  }
  return [...tags].sort();
}

/**
 * A deployment whose roster grants nobody `credential.manage` cannot recover a
 * lost password through the UI. Worth a loud startup warning, but not fatal:
 * the CLI in `scripts/set-password.cjs` still works, and refusing to boot
 * would turn a misconfigured roster into an outage.
 */
export function rosterWarnings(): string[] {
  const warnings: string[] = [];
  const active = listMembers();

  if (active.length === 0) {
    warnings.push("名册为空，没有人能登录。请在 content/roster/ 下添加成员。");
  } else if (!active.some((member) => member.role === "admin")) {
    warnings.push("名册中没有启用状态的管理员，/admin 将无人可进入。");
  }

  return warnings;
}
