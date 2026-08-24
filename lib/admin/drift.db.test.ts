import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { loadAdminOverview } from "./drift";

/**
 * The one failure mode nothing in the product could report.
 *
 * With no relay configured every send still succeeds — it goes to the server
 * log — so registration and password recovery are dead ends that look like
 * they are working from every angle a user or an operator has. `/admin` is the
 * only surface positioned to say otherwise, and `mailIsConfigured()` sat
 * exported with no callers until it was wired here.
 *
 * Counts real rows, so it runs against a real Postgres and skips itself when
 * there is none.
 */
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

/** Whichever finding is about the relay, without pinning its wording. */
function mailFinding(findings: { title: string; severity: string }[]) {
  return findings.find((finding) => finding.title.includes("SMTP"));
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describeDb("运维台偏差：邮件", () => {
  it("没有中继时报出来，因为注册与找回对用户已经失效", async () => {
    vi.stubEnv("FOI_SMTP_HOST", undefined);

    const finding = mailFinding((await loadAdminOverview()).findings);

    expect(finding).toBeDefined();
    // A warning, not a note: this is a broken feature rather than a row that
    // wants a second look.
    expect(finding?.severity).toBe("warn");
  });

  it("配了中继就不报，否则这条会变成人人都学会忽略的常驻噪音", async () => {
    vi.stubEnv("FOI_SMTP_HOST", "smtp.example.com");

    expect(mailFinding((await loadAdminOverview()).findings)).toBeUndefined();
  });
});
