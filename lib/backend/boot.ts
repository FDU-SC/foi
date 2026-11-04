import { externallyJudged } from "@/lib/problems/registry";
import { envFragment } from "./env";
import { backends } from "./registry";

const PER_BACKEND_SECRET = /^FOI_BACKEND_[A-Z0-9_]+_SECRET$/;

/**
 * Every queue key derives from `FOI_BACKEND_SECRET`, so a per-backend key
 * variable on the platform has no effect. Naming it keeps an operator from
 * handing that value to a runner, whose every request would then fail to verify.
 */
export function ignoredBackendSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return Object.keys(env)
    .filter((name) => PER_BACKEND_SECRET.test(name) && env[name])
    .sort()
    .map(
      (name) => `${name} 不生效：队列密钥一律由 FOI_BACKEND_SECRET 派生。`,
    );
}

export function backendsMissingActionUrl(): string[] {
  return externallyJudged()
    .filter((problem) => Object.keys(problem.backend.actions).length > 0)
    .map((problem) => problem.backend.id)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .filter((id) => !backends[id]?.url)
    .map((id) => {
      const variable = `FOI_BACKEND_${envFragment(id)}_URL`;
      return `${variable}: 未设置`;
    });
}
