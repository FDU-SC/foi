import { policyModules } from "@/content/_modules/policies";
import { ACTION_IDS, isQueryable, type ActionId } from "./actions";
import { builtinPolicies } from "./builtin";
import { compiledPolicySchema, type CompiledPolicy } from "./types";

interface Source {
  path: string;
  policies: CompiledPolicy[];
}

interface Registry {
  all: CompiledPolicy[];
  byAction: Map<ActionId, CompiledPolicy[]>;
}

function contentSources(): Source[] {
  return Object.entries(policyModules)
    .sort(([a], [b]) => a.localeCompare(b))
    .flatMap(([path, mod]) => {
      const exported = (mod as { policies?: unknown }).policies;
      if (exported === undefined) return [];

      if (!Array.isArray(exported)) {
        throw new Error(`${path} 导出的 policies 必须是数组`);
      }

      return [{ path, policies: exported as CompiledPolicy[] }];
    });
}

function validate(candidate: unknown, path: string, index: number): CompiledPolicy {
  const parsed = compiledPolicySchema.safeParse(candidate);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join(".") || "(root)"}: ${issue.message}`)
      .join("\n");
    throw new Error(
      `${path} 第 ${index + 1} 条策略不合法:\n${issues}\n` +
        `策略必须用 lib/authz/types.ts 的 policy() 构造。`,
    );
  }

  return parsed.data as CompiledPolicy;
}

/**
 * A row-level condition has to be expressible twice: once as a predicate over
 * one resource, once as SQL over the whole table. Listing endpoints ask the
 * database, so a policy that only knows how to answer the first form would
 * silently drop out of every list.
 */
function assertQueryable(entry: CompiledPolicy, path: string): void {
  if (!entry.when || entry.filter) return;

  const queryable = entry.actions.filter(isQueryable);
  if (queryable.length === 0) return;

  throw new Error(
    `${path} 的策略 "${entry.id}" 覆盖了 ${queryable.join("、")}，` +
      `这些动作要从数据库里成批取行，所以带 when 的策略必须同时给出 filter。` +
      (entry.wildcard
        ? `如果这条策略本就不该管这些动作，把 action 从 "*" 改成显式列表。`
        : ``),
  );
}

function build(): Registry {
  const all: CompiledPolicy[] = [];
  const sources = new Map<string, string>();

  const declared: Source[] = [
    { path: "lib/authz/builtin.ts", policies: builtinPolicies() },
    ...contentSources(),
  ];

  for (const source of declared) {
    source.policies.forEach((raw, index) => {
      const entry = validate(raw, source.path, index);

      const existing = sources.get(entry.id);
      if (existing) {
        throw new Error(
          `策略 "${entry.id}" 重复声明: ${existing} 与 ${source.path}`,
        );
      }
      sources.set(entry.id, source.path);

      assertQueryable(entry, source.path);
      all.push(entry);
    });
  }

  const byAction = new Map<ActionId, CompiledPolicy[]>(
    ACTION_IDS.map((action) => [action, []]),
  );
  for (const entry of all) {
    for (const action of entry.actions) byAction.get(action)?.push(entry);
  }

  return { all, byAction };
}

/**
 * Built on first use rather than at module evaluation: the builtin policies
 * reach back into the engine, and the engine reads this registry. Deferring
 * the work keeps that a runtime reference instead of a load-order hazard.
 * `assertPolicyRegistry` forces it during boot so misconfiguration still
 * surfaces before the first request.
 */
let registry: Registry | null = null;

function ensure(): Registry {
  return (registry ??= build());
}

export function policiesFor(action: ActionId): CompiledPolicy[] {
  return ensure().byAction.get(action) ?? [];
}

export function allPolicies(): CompiledPolicy[] {
  return ensure().all;
}

export function assertPolicyRegistry(): void {
  ensure();
}
