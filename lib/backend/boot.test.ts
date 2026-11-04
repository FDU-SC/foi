import { afterEach, describe, expect, it } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { externallyJudged } from "@/lib/problems/registry";
import {
  backendsMissingActionUrl,
  ignoredBackendSecrets,
} from "./boot";

describe("ignoredBackendSecrets", () => {
  it("只有主密钥时什么都不报", () => {
    expect(
      ignoredBackendSecrets({ FOI_BACKEND_SECRET: "master-key" }),
    ).toEqual([]);
  });

  it("点出每个设了值的专属密钥变量", () => {
    const complaints = ignoredBackendSecrets({
      FOI_BACKEND_SECRET: "master-key",
      FOI_BACKEND_A_BACKEND_SECRET: "leftover",
      FOI_BACKEND_ANOTHER_SECRET: "leftover",
    });

    expect(complaints).toHaveLength(2);
    expect(complaints[0]).toContain("FOI_BACKEND_ANOTHER_SECRET");
    expect(complaints[1]).toContain("FOI_BACKEND_A_BACKEND_SECRET");
  });

  it("留空的变量与地址变量不报", () => {
    expect(
      ignoredBackendSecrets({
        FOI_BACKEND_A_BACKEND_SECRET: "",
        FOI_BACKEND_A_BACKEND_URL: "http://backend.internal:4100",
      }),
    ).toEqual([]);
  });
});

describe("backendsMissingActionUrl", () => {
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
});
