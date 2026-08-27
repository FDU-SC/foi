import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { externallyJudged } from "@/lib/problems/registry";
import { problemsServedBy, orphanedBackends } from "./access";
import {
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
  });

  it("两台以上回落到共享密钥时，把它们都点出来", () => {
    if (inUse.length < 2) return;
    scatter();

    const complaints = backendsSharingSecret();
    expect(complaints).toHaveLength(1);
    for (const id of inUse) expect(complaints[0]).toContain(id);
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

    const complaints = backendsSharingSecret();
    expect(complaints).toHaveLength(1);
    for (const id of inUse) expect(complaints[0]).toContain(id);
  });

  it("没有题目指向的后端从不参与，哪怕它也没有密钥", () => {
    scatter();
    for (const id of orphanedBackends()) {
      patch(id, { secret: undefined, url: `http://orphan-${id}:4100` });
    }

    const complaints = backendsSharingSecret();
    const joined = complaints.join("\n");
    for (const id of orphanedBackends()) {
      expect(joined).not.toContain(id);
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

    const complaints = backendsSharingSecret();
    expect(complaints).toHaveLength(1);
    expect(complaints[0]).toContain(inUse[0]);
    expect(complaints[0]).toContain(inUse[1]);
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
 * The two findings that refuse a production boot, asked here only for *whether
 * there is one*.
 *
 * Neither reads the tier any more: which of these stops a boot is
 * `lib/boot/checks.ts`'s decision and is pinned there. What has to hold on this
 * side is that a deployment in the dangerous shape produces a complaint at all
 * — and, for the action-URL one, that the complaint names the variable to set,
 * since that is the only part of it that tells an operator what to do next.
 */
describe("拒绝启动级别的发现", () => {
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

  describe("backendsSharingSecret", () => {
    it("几台共用一把密钥就报，并点名是哪几台", () => {
      if (inUse.length < 2) return;
      vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
      for (const id of inUse) patch(id, { secret: undefined });

      const complaints = backendsSharingSecret();
      expect(complaints).toHaveLength(1);
      for (const id of inUse) expect(complaints[0]).toContain(id);
    });

    it("各自有密钥时什么都不报", () => {
      vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
      for (const id of inUse) patch(id, { secret: `secret-for-${id}` });

      expect(backendsSharingSecret()).toEqual([]);
    });

    /**
     * The severity used to live in this function, which meant the dangerous
     * shape produced nothing at all outside production and the sentence had to
     * exist twice. One wording now, and the tier decides what to do with it.
     */
    it("不看 NODE_ENV——严重性不在这一层", () => {
      if (inUse.length < 2) return;
      vi.stubEnv("NODE_ENV", "development");
      vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
      for (const id of inUse) patch(id, { secret: undefined });

      expect(backendsSharingSecret()).toHaveLength(1);
    });
  });

  describe("backendsMissingActionUrl", () => {
    it("有题目声明了动作、后端却没有地址时，点名该填哪个变量", () => {
      if (withActions.length === 0) return;
      for (const id of withActions) patch(id, { url: undefined });

      const complaints = backendsMissingActionUrl();
      expect(complaints.length).toBeGreaterThan(0);
      const joined = complaints.join("\n");
      for (const id of withActions) {
        expect(joined).toContain(`FOI_BACKEND_${id.toUpperCase().replace(/-/g, "_")}_URL`);
      }
    });

    it("地址都填了就什么都不报", () => {
      for (const id of Object.keys(backends)) {
        patch(id, { url: "http://backend.internal:4100" });
      }

      expect(backendsMissingActionUrl()).toEqual([]);
    });

    /**
     * The narrowing this check exists for: judging is pulled, so a backend
     * nothing declares an action on needs no address at all and must not hold
     * a deployment down for missing one.
     */
    it("只判题、不做交互的后端没有地址也不算缺", () => {
      for (const id of Object.keys(backends)) {
        patch(id, {
          url: withActions.includes(id)
            ? "http://backend.internal:4100"
            : undefined,
        });
      }

      expect(backendsMissingActionUrl()).toEqual([]);
    });
  });
});
