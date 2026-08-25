import type { Viewer } from "@/lib/auth/viewer";
import { problemFor } from "@/lib/problems/access";
import { externallyJudged } from "@/lib/problems/registry";
import { backends } from "@/backends.config";

/**
 * Which backends this deployment actually uses, and what it needs from each.
 *
 * The file has grown a second job since the direction reversed. It still
 * answers who may see a backend exist; it now also holds the two boot checks
 * that used to be in `lib/env.ts` and could not stay there, because both
 * questions changed from "is this variable set" to "is this variable set *for
 * the backends that need it*" — and knowing which those are means reading the
 * problem registry, which `lib/env.ts` deliberately cannot do.
 */

/**
 * Which backends a person may know about.
 *
 * There was no answer to this before: `/judges` and its API required a login
 * and nothing else, so every account saw every backend. Redaction hid the
 * address and which problem each queue entry was for, but not the backend's
 * existence, its health, or how deep its queue ran — and a backend that only
 * serves an unopened round announces that round by being busy. Gating the
 * statement while leaving that visible only moves where the leak is.
 *
 * A backend is therefore shown when the viewer can see at least one problem it
 * serves. Holders of `backend.inspect` see all of them, including ones nothing
 * references, because their job is the infrastructure rather than the round.
 *
 * **The problem set is derived, not declared.** Every problem already names
 * its backend in `problem.backend.id`, so inverting that index is exact and
 * cannot drift. Having backends list their problems instead would duplicate
 * the relationship and reintroduce precisely the failure this codebase keeps
 * hitting: a second place to remember, and a new problem whose backend
 * silently has the wrong audience because nobody updated it.
 */
function buildIndex(): Map<string, string[]> {
  const index = new Map<string, string[]>();

  // Inline problems are absent by construction: they have no backend to serve
  // them, and filing them under a placeholder would make a real backend look
  // busy to the audience gate below.
  for (const problem of externallyJudged()) {
    const slugs = index.get(problem.backend.id);
    if (slugs) slugs.push(problem.slug);
    else index.set(problem.backend.id, [problem.slug]);
  }

  return index;
}

const problemsByBackend = buildIndex();

/** Problem slugs this backend serves, per the problem registry. */
export function problemsServedBy(backendId: string): string[] {
  return problemsByBackend.get(backendId) ?? [];
}

/** Backends configured but named by no problem — nothing routes to them. */
export function orphanedBackends(): string[] {
  return Object.keys(backends).filter((id) => problemsServedBy(id).length === 0);
}

/**
 * Backends carrying real traffic that fall back to the shared signing key,
 * reported only when that actually weakens something.
 *
 * The weakness is a plural one: sharing a key with nobody is not sharing. What
 * makes it matter is a second backend holding the same value, because a runner
 * signing with it can then claim from either queue.
 *
 * **The count is over entries now, and it used to be over distinct addresses.**
 * That grouping existed because two entries pointing at one URL really were one
 * process with one key, and telling an operator to split a key they cannot
 * split is how a warning becomes something everybody scrolls past. It cannot
 * survive the direction change: judging needs no address, so most entries have
 * none, and grouping by `undefined` would collapse every backend in a
 * production deployment into a single imaginary service and report nothing at
 * all. A deployment that genuinely runs one runner for two backends now says so
 * by setting both `FOI_BACKEND_<NAME>_SECRET` variables to the same value —
 * which is explicit, and is what the message has always asked for anyway.
 *
 * **Which backends count is derived, not declared**, for the same reason the
 * index above is. #22 proposed requiring all six entries to be filled in, which
 * would have meant configuring a key for a backend nothing routes to, and would
 * have made `.env.production.example` a second list to keep in step with
 * `backends.config.ts`. `problemsServedBy` already knows which backends a
 * deployment actually uses, so the check is built on that.
 */
export function backendsSharingSecret(): string[] {
  const borrowing = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0 && !backends[id].secret,
  );

  return borrowing.length > 1 ? borrowing : [];
}

const SHARED_SECRET_MESSAGE =
  `都在使用共享的 FOI_BACKEND_SECRET：拉模型下这把密钥是评测机进来的凭证，` +
  `拿到它就能领走该后端队列里的任意提交、读到里面所有人的代码、写任意评测结果。` +
  `几台共用一把，等于其中任何一台被攻破，另外几台的队列也一起丢。` +
  `为每台服务设置各自的 FOI_BACKEND_<名字>_SECRET，并同步到后端本身` +
  `（确实由同一套评测机服务的多个条目，把它们填成相同的值）。`;

/**
 * Refuses a production boot on a shared signing key.
 *
 * This was a warning for as long as the key pointed outward. Under the push
 * model it authenticated us to a backend, lived on a server we control, and its
 * worst case was somebody impersonating the platform. Reversing the direction
 * reversed all three: it now authenticates a runner to us, it lives on whatever
 * machine somebody runs a runner on — donated hardware, a laptop behind a NAT —
 * and it buys its holder a whole queue's worth of other people's source. The
 * blast radius and the exposed surface both grew at once, which is what moves
 * this from "worth mentioning" to "not like this".
 *
 * Fatal only in production, because outside it every backend shares the mock's
 * key and that is simply what a checkout looks like. Not in `assertEnv` because
 * `lib/env.ts` would have to import the content registry to know which backends
 * carry traffic, and it deliberately knows nothing about content.
 */
export function assertBackendSecrets(): void {
  if (process.env.NODE_ENV !== "production") return;

  const sharing = backendsSharingSecret();
  if (sharing.length === 0) return;

  throw new Error(
    `题目后端签名密钥配置不安全，拒绝启动:\n  - ${sharing.join("、")} ${SHARED_SECRET_MESSAGE}`,
  );
}

/**
 * Said at startup outside production, next to the enrollment and contest
 * warnings. In production `assertBackendSecrets` has already refused the boot.
 */
export function backendSecretWarnings(): string[] {
  const sharing = backendsSharingSecret();
  if (sharing.length === 0) return [];

  return [`题目后端 ${sharing.join("、")} ${SHARED_SECRET_MESSAGE}`];
}

/**
 * Backends a problem declares an interactive action on but that have no
 * address, named by the variable to set.
 *
 * The narrowed replacement for the old "every entry needs a URL" boot check,
 * and the narrowing is the whole point of it having moved here. That check
 * lived in `lib/env.ts` because every backend was dispatched to, so the answer
 * needed nothing but the environment. Only actions go outward now, and which
 * backends have actions is a fact about `content/problems/*` — so the question
 * cannot be answered without the registry, and this is the file that already
 * has it.
 *
 * Fatal in production for the same reason the old one was: a missing address is
 * silent at boot and expensive afterwards. A player presses "启动实例" and gets
 * a 500 they cannot act on, which is exactly the failure `FOI_PUBLIC_URL` is
 * mandatory to avoid.
 */
export function backendsMissingActionUrl(): string[] {
  return externallyJudged()
    .filter((problem) => Object.keys(problem.backend.actions).length > 0)
    .map((problem) => problem.backend.id)
    .filter((id, index, ids) => ids.indexOf(id) === index)
    .filter((id) => !backends[id]?.url)
    .map((id) => `FOI_BACKEND_${id.replace(/-/g, "_").toUpperCase()}_URL`);
}

/** Refuses a production boot on an interactive backend with nowhere to call. */
export function assertBackendActionUrls(): void {
  if (process.env.NODE_ENV !== "production") return;

  const missing = backendsMissingActionUrl();
  if (missing.length === 0) return;

  throw new Error(
    `有题目声明了交互动作，但对应的题目后端没有地址，拒绝启动:\n` +
      missing
        .map(
          (variable) =>
            `  - ${variable}: 未设置。评测不需要地址（评测机自己来领活），` +
            `但 spawn/poll/destroy 这类动作是平台同步发起的，拉不了。` +
            `填上它的地址；这套部署不开这道题，就把题目的 actions 去掉`,
        )
        .join("\n"),
  );
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
 * `assertBackendActionUrls` can prove `FOI_BACKEND_<NAME>_URL` was set; it
 * cannot prove the address means anything, and the way a deployment goes wrong
 * is by copying the line out of `.env.example`. Inside the app container
 * `localhost:4100` is the app container, and an action posted there gets a
 * connection refused that surfaces to a player as a container that will not
 * start.
 *
 * A smaller finding than it was, and only because there is so much less to get
 * wrong: an address only matters for interactive actions now, so a copied
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

/**
 * Whether this viewer may know the backend exists.
 *
 * An inspector always may, including for backends nothing routes to — that gap
 * is theirs to notice. Everyone else needs one problem on it that they can
 * already see: with none, the backend's queue depth is a readout of activity
 * on material they have not been shown.
 *
 * Asked through `problemFor` rather than the raw gate so the two answers
 * cannot disagree — a preview holder sees an embargoed problem, so they see
 * its backend too, and nothing extra had to be written to make that true.
 */
export function canSeeBackend(
  backendId: string,
  viewer: Viewer,
  now = new Date(),
): boolean {
  if (viewer.can("backend.inspect")) return true;

  return problemsServedBy(backendId).some(
    (slug) => problemFor(slug, viewer, now) !== undefined,
  );
}

/** The backend ids this viewer may be shown, in configuration order. */
export function backendsFor(viewer: Viewer, now = new Date()): string[] {
  return Object.keys(backends).filter((id) => canSeeBackend(id, viewer, now));
}
