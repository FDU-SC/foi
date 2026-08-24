import { afterEach, describe, expect, it } from "vitest";
import { backends, type ProblemBackend } from "@/backends.config";
import { AS_PLAYER, viewerFor, type Viewer } from "@/lib/auth/viewer";
import { allContests } from "@/lib/contests/registry";
import { problemFor } from "@/lib/problems/access";
import { allProblems } from "@/lib/problems/registry";
import {
  backendSecretWarnings,
  backendsSharingSecret,
  canSeeBackend,
  backendsFor,
  orphanedBackends,
  problemsServedBy,
} from "./access";

const PREVIEW = viewerFor({ handle: "an-admin", groups: ["管理员"] });

/**
 * Sees unreleased problems but not the infrastructure.
 *
 * Built by hand because no shipped role holds that combination — which is the
 * point of the case: `problem.viewAll` and `backend.inspect` have to stay
 * independent, so that a deployment adding such a role gets the behaviour
 * without also having to touch the gate.
 */
const SETTER: Viewer = {
  handle: "setter",
  groups: ["出题人"],
  can: (capability) => capability === "problem.viewAll",
};

const demo = allContests().find((contest) => contest.slug === "demo-acm");

function before(date: Date): Date {
  return new Date(date.getTime() - 60_000);
}

describe("题目后端→题目 反向索引", () => {
  it("每道题都反查到它自己声明的题目后端", () => {
    for (const problem of allProblems()) {
      expect(problemsServedBy(problem.backend.id)).toContain(problem.slug);
    }
  });

  it("索引覆盖题目声明的全部题目后端 id", () => {
    const declared = new Set(allProblems().map((p) => p.backend.id));
    for (const id of declared) {
      expect(problemsServedBy(id).length).toBeGreaterThan(0);
    }
  });

  it("未知题目后端反查为空", () => {
    expect(problemsServedBy("no-such-backend")).toEqual([]);
  });

  it("orphanedBackends 列出没有任何题目指向的题目后端", () => {
    const referenced = new Set(allProblems().map((p) => p.backend.id));
    for (const id of orphanedBackends()) {
      expect(referenced.has(id)).toBe(false);
    }
  });
});

describe("canSeeBackend", () => {
  it("持有 backend.inspect 的人看得到全部题目后端，包括没有题目指向的", () => {
    for (const id of Object.keys(backends)) {
      expect(canSeeBackend(id, PREVIEW)).toBe(true);
    }
  });

  it("选手只看得到承载了至少一道他能看到的题目的题目后端", () => {
    for (const id of Object.keys(backends)) {
      const reachable = problemsServedBy(id).some(
        (slug) => problemFor(slug, AS_PLAYER) !== undefined,
      );
      expect(canSeeBackend(id, AS_PLAYER)).toBe(reachable);
    }
  });

  it("没有任何题目指向的题目后端对选手不可见", () => {
    for (const id of orphanedBackends()) {
      expect(canSeeBackend(id, AS_PLAYER)).toBe(false);
    }
  });

  it("只承载未开赛题目的题目后端，对选手隐藏、对出题人可见", () => {
    if (!demo) return;
    const slug = demo.problems[0].slug;
    const backendId = allProblems().find((p) => p.slug === slug)?.backend.id;
    if (!backendId) return;

    // Pick a moment before the contest opens, and only assert when this backend
    // serves nothing else — otherwise another problem legitimately reveals it.
    const at = before(demo.startsAt);
    const others = problemsServedBy(backendId).filter((s) => s !== slug);
    const otherVisible = others.some(
      (s) => problemFor(s, AS_PLAYER, at) !== undefined,
    );

    if (!otherVisible) {
      expect(canSeeBackend(backendId, AS_PLAYER, at)).toBe(false);
    }
    // A setter sees the problem, so seeing its backend reveals nothing further.
    expect(canSeeBackend(backendId, SETTER, at)).toBe(true);
  });
});

/**
 * One key for every backend means one compromised backend can sign as all of
 * them, and the callback route re-checks a verdict against the key of the
 * backend it was dispatched to precisely so that distinct keys can stop that.
 *
 * `backends` is read at import, so these cases edit the entries rather than the
 * environment — the same reason `groups.test.ts` reaches into `IMPLIES`. Every
 * one restores what it touched.
 */
describe("共用签名密钥的题目后端", () => {
  const inUse = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0,
  );

  const saved = new Map<string, ProblemBackend>();

  /** Replaces an entry wholesale, remembering the original exactly once. */
  function patch(id: string, changes: Partial<ProblemBackend>): void {
    if (!saved.has(id)) saved.set(id, backends[id]);
    backends[id] = { ...backends[id], ...changes };
  }

  /** Distinct addresses, so the plural weakness this reports on is real. */
  function scatter(): void {
    inUse.forEach((id, index) => {
      patch(id, { secret: undefined, url: `http://backend-${index}:4100` });
    });
  }

  afterEach(() => {
    for (const [id, entry] of saved) backends[id] = entry;
    saved.clear();
  });

  it("各自有密钥时什么都不报", () => {
    scatter();
    for (const id of inUse) patch(id, { secret: `secret-for-${id}` });

    expect(backendsSharingSecret()).toEqual([]);
    expect(backendSecretWarnings()).toEqual([]);
  });

  it("两台以上回落到共享密钥时，把它们都点出来", () => {
    if (inUse.length < 2) return;
    scatter();

    expect(backendsSharingSecret().sort()).toEqual([...inUse].sort());
    expect(backendSecretWarnings()).toHaveLength(1);
    expect(backendSecretWarnings()[0]).toContain(inUse[0]);
  });

  it("只剩一台回落时不报——和谁都没共用就不算共用", () => {
    if (inUse.length < 2) return;
    scatter();
    for (const id of inUse.slice(1)) patch(id, { secret: `secret-for-${id}` });

    expect(backendsSharingSecret()).toEqual([]);
  });

  /**
   * The default shape of this repository, and of any deployment that puts two
   * kinds of problem on one judge: those entries are one process holding one
   * key, so asking for a split asks for something impossible — and a warning
   * that fires on every `pnpm dev` is one nobody reads by the time it matters.
   */
  it("指向同一地址的多个条目算一个服务，不报", () => {
    if (inUse.length < 2) return;
    for (const id of inUse) {
      patch(id, { secret: undefined, url: "http://localhost:4100" });
    }

    expect(backendsSharingSecret()).toEqual([]);
  });

  it("没有题目指向的后端从不参与，哪怕它也没有密钥", () => {
    scatter();
    for (const id of orphanedBackends()) {
      patch(id, { secret: undefined, url: `http://orphan-${id}:4100` });
    }

    const reported = backendsSharingSecret();
    for (const id of orphanedBackends()) {
      expect(reported).not.toContain(id);
    }
  });
});

describe("backendsFor", () => {
  it("选手拿到的题目后端是全集的子集", () => {
    const all = Object.keys(backends);
    const forPlayer = backendsFor(AS_PLAYER);

    expect(forPlayer.every((id) => all.includes(id))).toBe(true);
    expect(forPlayer.length).toBeLessThanOrEqual(all.length);
  });

  it("检查者拿到全集", () => {
    expect(backendsFor(PREVIEW).sort()).toEqual(Object.keys(backends).sort());
  });

  it("与 canSeeBackend 逐项一致", () => {
    const forPlayer = new Set(backendsFor(AS_PLAYER));
    for (const id of Object.keys(backends)) {
      expect(forPlayer.has(id)).toBe(canSeeBackend(id, AS_PLAYER));
    }
  });
});
