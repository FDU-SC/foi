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
    `题目后端 ${onSharedValue.join("、")} ` +
      `都在使用共享的 FOI_BACKEND_SECRET：拉模型下这把密钥是评测机进来的凭证，` +
      `拿到它就能领走该后端队列里的任意提交、读到里面所有人的代码、写任意评测结果。` +
      `几台共用一把，等于其中任何一台被攻破，另外几台的队列也一起丢。` +
      `为每台服务设置各自的 FOI_BACKEND_<名字>_SECRET，并同步到后端本身` +
      `（确实由同一套评测机服务的多个条目，把它们填成相同的值）。`,
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
      return (
        `${variable}: 未设置。评测不需要地址（评测机自己来领活），` +
        `但交互动作是平台代选手同步发起的，拉不了。` +
        `填上它的地址；这套部署不开这道题，就把题目的 actions 去掉`
      );
    });
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

export function backendsOnLoopback(): string[] {
  return Object.keys(backends).filter((id) => {
    const url = backends[id].url;
    if (!url || problemsServedBy(id).length === 0) return false;

    try {
      return isLoopback(new URL(url).hostname);
    } catch {

      return false;
    }
  });
}
