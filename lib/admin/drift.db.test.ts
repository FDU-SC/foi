import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ProblemBackend } from "@/lib/backend/types";
import { backends } from "@/lib/backend/registry";
import { problemsServedBy } from "@/lib/backend/access";
import { db } from "@/lib/db";
import { loadAdminOverview } from "./drift";

const declared = vi.hoisted(() => ({
  mailDelivery: null as "smtp" | "console" | null,
}));

vi.mock("@/lib/enrollment/registry", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@/lib/enrollment/registry")>();
  return {
    ...actual,
    enrollmentPolicy: {
      ...actual.enrollmentPolicy,
      get mailDelivery() {
        return declared.mailDelivery ?? actual.enrollmentPolicy.mailDelivery;
      },
    },
  };
});

async function reachable(): Promise<boolean> {
  try {
    await db.execute(sql`select 1`);
    return true;
  } catch {
    return false;
  }
}

const online = await reachable();
const describeDb = online ? describe : describe.skip;

if (!online) {
  console.warn("[test] 数据库不可达，跳过运维台偏差用例");
}

type Finding = { title: string; severity: string; items: string[] };

function findingAbout(findings: Finding[], word: string) {
  return findings.find((finding) => finding.title.includes(word));
}

const savedBackends = new Map<string, ProblemBackend>();

function patchBackend(id: string, changes: Partial<ProblemBackend>): void {
  if (!savedBackends.has(id)) savedBackends.set(id, backends[id]);
  backends[id] = { ...backends[id], ...changes };
}

afterEach(() => {
  vi.unstubAllEnvs();
  declared.mailDelivery = null;
  for (const [id, entry] of savedBackends) backends[id] = entry;
  savedBackends.clear();
});

describeDb("运维台偏差：邮件", () => {
  it("声明了 smtp 却没有中继时报出来，因为注册与找回对用户已经失效", async () => {
    declared.mailDelivery = "smtp";
    vi.stubEnv("FOI_SMTP_HOST", undefined);

    const finding = findingAbout((await loadAdminOverview()).findings, "SMTP");

    expect(finding).toBeDefined();

    expect(finding?.severity).toBe("warn");
  });

  it("声明了 smtp 且配了中继就不报，否则这条会变成人人都学会忽略的常驻噪音", async () => {
    declared.mailDelivery = "smtp";
    vi.stubEnv("FOI_SMTP_HOST", "smtp.example.com");

    expect(
      findingAbout((await loadAdminOverview()).findings, "SMTP"),
    ).toBeUndefined();
  });

  it("声明了 console 就不报——那是个决定，不是可以修的偏差", async () => {
    declared.mailDelivery = "console";

    for (const host of [undefined, "smtp.example.com"]) {
      vi.stubEnv("FOI_SMTP_HOST", host);

      expect(
        findingAbout((await loadAdminOverview()).findings, "SMTP"),
      ).toBeUndefined();
    }
  });
});

describeDb("运维台偏差：题目后端签名密钥", () => {
  const inUse = Object.keys(backends).filter(
    (id) => problemsServedBy(id).length > 0,
  );

  it("两个服务共用一个密钥时报出来，并列出该配哪几台", async () => {
    if (inUse.length < 2) return;
    inUse.forEach((id, index) => {
      patchBackend(id, { secret: undefined, url: `http://backend-${index}:4100` });
    });

    const finding = findingAbout((await loadAdminOverview()).findings, "签名密钥");

    expect(finding?.severity).toBe("warn");
    expect(finding?.items.sort()).toEqual([...inUse].sort());
  });

  it("各自有密钥时不报", async () => {
    for (const id of inUse) patchBackend(id, { secret: `secret-for-${id}` });

    expect(
      findingAbout((await loadAdminOverview()).findings, "签名密钥"),
    ).toBeUndefined();
  });

  it("仓库默认配置——全部回落到共享密钥——照样报", async () => {
    if (inUse.length < 2) return;

    const finding = findingAbout(
      (await loadAdminOverview()).findings,
      "签名密钥",
    );

    expect(finding?.severity).toBe("warn");
    expect(finding?.items.sort()).toEqual([...inUse].sort());
  });
});
