import { externallyJudged } from "@/lib/problems/registry";
import { problemsServedBy } from "./access";
import { envFragment, sharedSecret } from "./env";
import { backends } from "./registry";
import { effectiveSecret } from "./resolve";

/**
 * What this deployment needs from each backend, phrased as complaints rather
 * than refusals.
 *
 * None of these can live in `lib/env.ts`. Each asks not "is this variable set"
 * but "is it set *for the backends that need it*", and knowing which those are
 * means reading the problem registry, which `lib/env.ts` deliberately cannot
 * do.
 *
 * Nothing here decides whether a complaint stops the boot. That depends on the
 * tier, and the tier is one decision for the whole process rather than three
 * copies of `if (tier() !== "prod") return` in three modules — see
 * `lib/boot/checks.ts`. Keeping it out also leaves these callable by
 * `lib/admin/drift.ts`, which has to report the same conditions from a page
 * that still renders.
 */

/**
 * Backends carrying real traffic that end up signing with the shared key,
 * reported only when that actually weakens something.
 *
 * The weakness is a plural one: sharing a key with nobody is not sharing. What
 * makes it matter is a second backend holding the same value, because a runner
 * signing with it can then claim from either queue.
 *
 * **The count is over entries, not over distinct addresses.** Grouping by URL
 * is the tempting alternative and no longer possible: judging needs no
 * address, so most entries have none, and grouping by `undefined` collapses
 * every backend in a production deployment into a single imaginary service and
 * reports nothing at all. A deployment that genuinely runs one runner for two
 * backends says so by setting both `FOI_BACKEND_<NAME>_SECRET` variables to
 * the same value, which is what the message below asks for anyway.
 *
 * **Which backends count is derived, not declared**, for the same reason the
 * index in `./access.ts` is. Requiring every entry to be filled in would mean
 * configuring a key for a backend nothing routes to, and would make
 * `.env.example` a second list to keep in step with `content/backends.ts`.
 *
 * Returns a formatted complaint string naming the offenders, or empty when
 * there is nothing to say. Refused in production and merely said elsewhere —
 * one wording rather than two that can drift, now that the tier decides the
 * severity instead of each call site.
 */
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

/**
 * Backends a problem declares an interactive action on but that have no
 * address, one complaint per missing variable.
 *
 * Deliberately not "every entry needs a URL": only actions go outward, and
 * which backends have actions is a fact about `content/problems/*`, so the
 * question cannot be answered from the environment alone.
 *
 * Fatal in production because a missing address is silent at boot and
 * expensive afterwards — a player presses "启动实例" and gets a 500 they cannot
 * act on.
 */
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

/** `localhost`, any `127.x`, and the v6 spelling `new URL` hands back. */
function isLoopback(hostname: string): boolean {
  return (
    hostname === "localhost" ||
    hostname === "[::1]" ||
    hostname.startsWith("127.")
  );
}

/**
 * Backends with an address that points back at this process.
 *
 * `backendsMissingActionUrl` can prove `FOI_BACKEND_<NAME>_URL` was set; it
 * cannot prove the address means anything, and the way a deployment goes wrong
 * is by copying the line out of `.env.example`. Inside the app container
 * `localhost:4100` is the app container, and an action posted there gets a
 * connection refused that surfaces to a player as a container that will not
 * start.
 *
 * A small finding: an address only matters for interactive actions, so a copied
 * `localhost` costs one problem's spawn button rather than every verdict in the
 * deployment.
 *
 * Reported rather than refused. A backend really can share a host with the app,
 * so loopback is a smell and not a fault, and taking a deployment down over a
 * smell is the worse failure. Whether it is worth saying at all depends on
 * where this is running, and that is the caller's to decide: during `pnpm dev`
 * every entry is the local mock and this is simply what a checkout looks like.
 */
export function backendsOnLoopback(): string[] {
  return Object.keys(backends).filter((id) => {
    const url = backends[id].url;
    if (!url || problemsServedBy(id).length === 0) return false;

    try {
      return isLoopback(new URL(url).hostname);
    } catch {
      // An address that will not parse is a different finding, and one an
      // action failing will report far more directly.
      return false;
    }
  });
}
