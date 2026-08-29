import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { externallyJudged } from "@/lib/problems/registry";
import { problemsServedBy, orphanedBackends } from "./access";
import {
  backendsMissingActionUrl,
  backendsSharingSecret,
} from "./boot";

describe("backendsSharingSecret", () => {
  const inUse = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0,
  );

  const saved = new Map<string, ProblemBackend>();

  function patch(id: string, changes: Partial<ProblemBackend>): void {
    if (!saved.has(id)) saved.set(id, backends[id]);
    backends[id] = { ...backends[id], ...changes };
  }

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

  it("只剩一台回落时不报——和谁都没共用就不算共用", () => {
    if (inUse.length < 2) return;
    scatter();
    for (const id of inUse.slice(1)) patch(id, { secret: `secret-for-${id}` });

    expect(backendsSharingSecret()).toEqual([]);
  });

  it("都写明了同一个值时不报——那是部署在说这几台确实是一台", () => {
    if (inUse.length < 2) return;
    vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
    for (const id of inUse) patch(id, { secret: "one-runner-for-both" });

    expect(backendsSharingSecret()).toEqual([]);
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

  it("两台以上回落到共享密钥时，把它们都点出来", () => {
    if (inUse.length < 2) return;
    scatter();

    const complaints = backendsSharingSecret();
    expect(complaints).toHaveLength(1);
    for (const id of inUse) expect(complaints[0]).toContain(id);
  });

  it("同一地址的多个条目不再算一台，照样点出来", () => {
    if (inUse.length < 2) return;
    for (const id of inUse) {
      patch(id, { secret: undefined, url: "http://localhost:4100" });
    }

    const complaints = backendsSharingSecret();
    expect(complaints).toHaveLength(1);
    for (const id of inUse) expect(complaints[0]).toContain(id);
  });

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

  it("不看 NODE_ENV——严重性不在这一层", () => {
    if (inUse.length < 2) return;
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("FOI_BACKEND_SECRET", "shared-key");
    for (const id of inUse) patch(id, { secret: undefined });

    expect(backendsSharingSecret()).toHaveLength(1);
  });
});

describe("backendsMissingActionUrl", () => {
  const problemsWithActions = externallyJudged().filter(
    (problem) => Object.keys(problem.backend.actions).length > 0,
  );
  const withActions = [
    ...new Set(
      problemsWithActions.map((problem) => problem.backend.id),
    ),
  ];

  const saved = new Map<string, ProblemBackend>();
  const savedRetired = new Map<(typeof problemsWithActions)[number], boolean>();

  function patch(id: string, changes: Partial<ProblemBackend>): void {
    if (!saved.has(id)) saved.set(id, backends[id]);
    backends[id] = { ...backends[id], ...changes };
  }

  afterEach(() => {
    for (const [id, entry] of saved) backends[id] = entry;
    for (const [problem, retired] of savedRetired) problem.retired = retired;
    saved.clear();
    savedRetired.clear();
  });

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

  it("已下架题目的交互后端没有地址也不算缺", () => {
    for (const problem of problemsWithActions) {
      savedRetired.set(problem, problem.retired);
      problem.retired = true;
      patch(problem.backend.id, { url: undefined });
    }

    expect(backendsMissingActionUrl()).toEqual([]);
  });
});
