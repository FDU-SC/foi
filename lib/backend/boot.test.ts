import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { externallyJudged } from "@/lib/problems/registry";
import { problemsServedBy, orphanedBackends } from "./access";
import {
  assertBackendActionUrls,
  assertBackendSecrets,
  backendSecretWarnings,
  backendsMissingActionUrl,
  backendsOnLoopback,
  backendsSharingSecret,
} from "./boot";

/**
 * One key for every backend means one compromised runner can claim from all of
 * their queues, and the runner routes re-check every request against the key of
 * the backend it names precisely so that distinct keys can stop that.
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

  /** Every entry borrowing the shared key, which is what gets reported. */
  function scatter(): void {
    inUse.forEach((id, index) => {
      patch(id, { secret: undefined, url: `http://backend-${index}:4100` });
    });
  }

  afterEach(() => {
    for (const [id, entry] of saved) backends[id] = entry;
    saved.clear();
    vi.unstubAllEnvs();
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
   * The grouping this used to do, and why it had to go. Two entries at one
   * address were one process holding one key, so the check let them share; with
   * judging pulled, an address says nothing about who evaluates a queue, and
   * grouping on the `undefined` that most entries now carry would report
   * nothing anywhere. A deployment really serving both from one runner says so
   * by filling in the same secret twice, which the case above covers.
   */
  it("同一地址的多个条目不再算一台，照样点出来", () => {
    if (inUse.length < 2) return;
    for (const id of inUse) {
      patch(id, { secret: undefined, url: "http://localhost:4100" });
    }

    expect(backendsSharingSecret().sort()).toEqual([...inUse].sort());
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

  /**
   * The arrangement the message asks for, and the one it must not nag about:
   * two entries really served by one runner say so by naming the same value
   * twice. Nobody is borrowing, so nobody is surprised.
   */
  it("都写明了同一个值时不报——那是部署在说这几台确实是一台", () => {
    if (inUse.length < 2) return;
    vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
    for (const id of inUse) patch(id, { secret: "one-runner-for-both" });

    expect(backendsSharingSecret()).toEqual([]);
  });

  /**
   * The gap between "has a key of its own" and "signs with its own value".
   * Filling in `FOI_BACKEND_<NAME>_SECRET` by copying `FOI_BACKEND_SECRET` is
   * the plausible way to arrive here, and the check used to read it as one
   * backend on the shared key — which is not sharing, so it said nothing. Two
   * backends are still signing with one value.
   */
  it("专属密钥的值恰好等于共享密钥时，照样算共用", () => {
    if (inUse.length < 2) return;
    vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
    scatter();
    patch(inUse[0], { secret: "shared-key" });
    for (const id of inUse.slice(2)) patch(id, { secret: `secret-for-${id}` });

    expect(backendsSharingSecret().sort()).toEqual([inUse[0], inUse[1]].sort());
  });

  /**
   * Legacy `FOI_JUDGE_SECRET` is the same fallback under an older name, so a
   * value copied out of it collides just as thoroughly. Still read, here and
   * in `withLegacyNames` in `lib/env.ts` — see `sharedSecret` in `./env.ts`
   * for why the two have to agree.
   */
  it("回落到旧名 FOI_JUDGE_SECRET 时也一样比得出来", () => {
    if (inUse.length < 2) return;
    vi.stubEnv("FOI_BACKEND_SECRET", undefined);
    vi.stubEnv("FOI_JUDGE_SECRET", "legacy-key");
    scatter();
    patch(inUse[0], { secret: "legacy-key" });
    for (const id of inUse.slice(2)) patch(id, { secret: `secret-for-${id}` });

    expect(backendsSharingSecret().sort()).toEqual([inUse[0], inUse[1]].sort());
  });
});

/**
 * The half `assertEnv` cannot reach.
 *
 * It can insist `FOI_BACKEND_<NAME>_URL` was set; nothing there can tell an
 * address apart from a leftover, and the leftover a deployment produces is the
 * development one — which inside the app container names the app container.
 *
 * Its own harness rather than the one above, because these cases edit the
 * addresses while those edit the keys, and a block that restores only what it
 * touched cannot leave the other one a surprise.
 */
describe("指向本机的题目后端", () => {
  const inUse = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0,
  );

  const saved = new Map<string, ProblemBackend>();

  function patch(id: string, changes: Partial<ProblemBackend>): void {
    if (!saved.has(id)) saved.set(id, backends[id]);
    backends[id] = { ...backends[id], ...changes };
  }

  /** Somewhere that is not this process, for every entry. */
  function elsewhere(): void {
    for (const id of Object.keys(backends)) {
      patch(id, { url: "http://host.docker.internal:4100" });
    }
  }

  afterEach(() => {
    for (const [id, entry] of saved) backends[id] = entry;
    saved.clear();
  });

  it("指向别处时什么都不报", () => {
    elsewhere();

    expect(backendsOnLoopback()).toEqual([]);
  });

  /**
   * What a checkout looks like, and the shape somebody copies into a
   * deployment by reaching for `.env.example`.
   */
  it("全部指向本机的 mock 时，列出每一台有题目指向的后端", () => {
    for (const id of Object.keys(backends)) {
      patch(id, { url: "http://localhost:4100" });
    }

    expect(backendsOnLoopback().sort()).toEqual([...inUse].sort());
  });

  it("127.0.0.1 与 [::1] 和 localhost 一样算", () => {
    if (inUse.length === 0) return;

    for (const address of ["http://127.0.0.1:4100", "http://[::1]:4100"]) {
      elsewhere();
      patch(inUse[0], { url: address });

      expect(backendsOnLoopback()).toEqual([inUse[0]]);
    }
  });

  /**
   * Same exclusion the shared-key check makes, for the same reason: no problem
   * names this backend, so nothing ever calls an action on it and where it
   * points cannot cost anybody anything.
   */
  it("没有题目指向的后端从不参与，哪怕它指向本机", () => {
    elsewhere();
    for (const id of orphanedBackends()) {
      patch(id, { url: "http://localhost:4100" });
    }

    expect(backendsOnLoopback()).toEqual([]);
  });

  /**
   * An address that will not parse is a different fault and one `/judges`
   * already shows as a backend it cannot reach. What matters here is that
   * asking the question does not take the whole operations console down.
   */
  it("地址不合法时既不报也不抛", () => {
    for (const id of inUse) patch(id, { url: "not an address" });

    expect(() => backendsOnLoopback()).not.toThrow();
    expect(backendsOnLoopback()).toEqual([]);
  });
});

/**
 * The two gates README argues must refuse a boot rather than warn, and which
 * nothing was holding to it. Both read `NODE_ENV` themselves and both are
 * silent outside production, so a test suite that never says `production`
 * exercises only the branch that returns immediately — the whole of what makes
 * them boot checks was uncovered.
 *
 * What is being pinned is the refusal, not the wording: a warning here is a
 * deployment that comes up and hands one runner every queue's source, or one
 * that comes up and answers a player's "启动实例" with a 500.
 */
describe("生产环境拒绝启动", () => {
  const inUse = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0,
  );

  /** The backends an address is actually required for; see the assert. */
  const withActions = [
    ...new Set(
      externallyJudged()
        .filter((problem) => Object.keys(problem.backend.actions).length > 0)
        .map((problem) => problem.backend.id),
    ),
  ];

  const saved = new Map<string, ProblemBackend>();

  function patch(id: string, changes: Partial<ProblemBackend>): void {
    if (!saved.has(id)) saved.set(id, backends[id]);
    backends[id] = { ...backends[id], ...changes };
  }

  afterEach(() => {
    for (const [id, entry] of saved) backends[id] = entry;
    saved.clear();
    vi.unstubAllEnvs();
  });

  describe("assertBackendSecrets", () => {
    it("生产环境下几台共用一把密钥就抛，并点名是哪几台", () => {
      if (inUse.length < 2) return;
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
      for (const id of inUse) patch(id, { secret: undefined });

      expect(() => assertBackendSecrets()).toThrow(/拒绝启动/);
      for (const id of inUse) {
        expect(() => assertBackendSecrets()).toThrow(new RegExp(id));
      }
    });

    it("各自有密钥时生产环境也照常启动", () => {
      vi.stubEnv("NODE_ENV", "production");
      vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
      for (const id of inUse) patch(id, { secret: `secret-for-${id}` });

      expect(() => assertBackendSecrets()).not.toThrow();
    });

    /**
     * A checkout has every backend on the mock's key, which is simply what
     * `pnpm dev` looks like — the warning list is where that gets said.
     */
    it("非生产环境只告警不拦，哪怕全都在共用", () => {
      if (inUse.length < 2) return;
      vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
      for (const id of inUse) patch(id, { secret: undefined });

      expect(() => assertBackendSecrets()).not.toThrow();
      expect(backendSecretWarnings()).toHaveLength(1);
    });
  });

  describe("assertBackendActionUrls", () => {
    it("有题目声明了动作、后端却没有地址时，生产环境拒绝启动", () => {
      if (withActions.length === 0) return;
      vi.stubEnv("NODE_ENV", "production");
      for (const id of withActions) patch(id, { url: undefined });

      expect(() => assertBackendActionUrls()).toThrow(/拒绝启动/);
      // Names the variable to set, which is the only part of the message that
      // tells an operator what to do next.
      for (const variable of backendsMissingActionUrl()) {
        expect(() => assertBackendActionUrls()).toThrow(new RegExp(variable));
      }
    });

    it("地址都填了就照常启动", () => {
      vi.stubEnv("NODE_ENV", "production");
      for (const id of Object.keys(backends)) {
        patch(id, { url: "http://backend.internal:4100" });
      }

      expect(backendsMissingActionUrl()).toEqual([]);
      expect(() => assertBackendActionUrls()).not.toThrow();
    });

    it("非生产环境缺地址不拦——本机跑不起 mock 也该能开发", () => {
      if (withActions.length === 0) return;
      for (const id of withActions) patch(id, { url: undefined });

      expect(backendsMissingActionUrl().length).toBeGreaterThan(0);
      expect(() => assertBackendActionUrls()).not.toThrow();
    });

    /**
     * The narrowing this check exists for: judging is pulled, so a backend
     * nothing declares an action on needs no address at all and must not hold
     * a deployment down for missing one.
     */
    it("只判题、不做交互的后端没有地址也不算缺", () => {
      vi.stubEnv("NODE_ENV", "production");
      for (const id of Object.keys(backends)) {
        patch(id, {
          url: withActions.includes(id)
            ? "http://backend.internal:4100"
            : undefined,
        });
      }

      expect(() => assertBackendActionUrls()).not.toThrow();
    });
  });
});
