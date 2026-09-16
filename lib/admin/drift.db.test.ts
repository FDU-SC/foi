import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { loadAdminOverview } from "./drift";

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

afterEach(() => {
  vi.unstubAllEnvs();
  globalThis.__foiBootWarnings = undefined;
});

describeDb("运维台偏差：启动警告", () => {
  it("启动时留下的提醒会出现在运维台", async () => {
    globalThis.__foiBootWarnings = ["FOI_SMTP_HOST 未设置"];

    const finding = findingAbout((await loadAdminOverview()).findings, "启动");

    expect(finding?.severity).toBe("warn");
    expect(finding?.items).toEqual(["FOI_SMTP_HOST 未设置"]);
  });

  it("没有启动提醒时不列这一项", async () => {
    globalThis.__foiBootWarnings = [];

    expect(
      findingAbout((await loadAdminOverview()).findings, "启动"),
    ).toBeUndefined();
  });
});
