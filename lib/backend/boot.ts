import { externallyJudged } from "@/lib/problems/registry";
import { problemsServedBy } from "./access";
import { envFragment, sharedSecret } from "./env";
import { backends } from "./registry";
import { effectiveSecret } from "./resolve";

export function backendsSharingSecret(): string[] {
  const onSharedValue = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0 && effectiveSecret(id) === sharedSecret(),
  );

  const borrowed = onSharedValue.some((id) => !backends[id].secret);
  if (!borrowed) return [];
  if (onSharedValue.length <= 1) return [];

  return [
    `后端 ${onSharedValue.join("、")} ` +
      `使用的 FOI_BACKEND_SECRET 相同。`
  ];
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
