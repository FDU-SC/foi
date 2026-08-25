import { sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { backends, type ProblemBackend } from "@/backends.config";
import { problemsServedBy } from "@/lib/backend/access";
import { db } from "@/lib/db";
import { loadAdminOverview } from "./drift";

/**
 * Things that are wrong with a deployment but not with any of its rows.
 *
 * Both cases below are conditions no page could surface on its own: a
 * deployment that says it sends mail and has nothing to send it with reports
 * every send as a success, and backends on a shared key work exactly as well
 * as backends on separate ones right up until one is compromised. Each is also
 * said at startup, in a container log that scrolled past weeks ago — so
 * `/admin` is where somebody actually meets them.
 *
 * Counts real rows, so it runs against a real Postgres and skips itself when
 * there is none.
 */

/**
 * The declared half of the mail finding.
 *
 * `loadAdminOverview` asks `mailDeliveryUnmet()` with no argument, so what it
 * reports depends on `content/enrollment/` every bit as much as on the
 * environment — and that is a real file on disk, which a test can neither edit
 * nor hand the overview a different copy of. Overriding the declaration here
 * is the only way to reach both halves of the combination; the environment
 * half stays `vi.stubEnv`, as it always was.
 *
 * The registry itself is left real, because the same call also resolves every
 * account's cohort. A getter rather than a fixed value because the default
 * parameter reads the policy on each call, and `null` means "whatever the
 * repository declares" — so the backend cases further down go on running
 * against the policy a checkout actually has.
 */
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

/** Matched on a substring, so the copy can be reworded without a red test. */
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

/**
 * Not "is there a relay" but "does this deployment have the relay it said it
 * needs". The finding reports a disagreement between two sources, so every
 * case here has to set both of them: a declaration alone says nothing, and so
 * does an environment.
 */
describeDb("运维台偏差：邮件", () => {
  it("声明了 smtp 却没有中继时报出来，因为注册与找回对用户已经失效", async () => {
    declared.mailDelivery = "smtp";
    vi.stubEnv("FOI_SMTP_HOST", undefined);

    const finding = findingAbout((await loadAdminOverview()).findings, "SMTP");

    expect(finding).toBeDefined();
    // A warning, not a note: this is a broken feature rather than a row that
    // wants a second look.
    expect(finding?.severity).toBe("warn");
  });

  it("声明了 smtp 且配了中继就不报，否则这条会变成人人都学会忽略的常驻噪音", async () => {
    declared.mailDelivery = "smtp";
    vi.stubEnv("FOI_SMTP_HOST", "smtp.example.com");

    expect(
      findingAbout((await loadAdminOverview()).findings, "SMTP"),
    ).toBeUndefined();
  });

  /**
   * The half the finding used to get wrong, and the reason it was rewritten.
   * Inferring the answer from `FOI_SMTP_HOST` alone meant a deployment that
   * had written `mailDelivery: "console"` on purpose — the value
   * `content/enrollment/example.ts` ships, so every fresh checkout — was told
   * at every visit to go fix a decision it had already made. An entry that can
   * never be resolved is one people learn to skim past, and they skim past the
   * ones under it too.
   *
   * Declared here rather than read off the shipped example, because what is
   * being pinned is the rule: a deployment that replaces that file with one
   * saying `smtp` must still be told when its relay is missing, and asserting
   * on the example's current value would quietly swap this case for that one.
   */
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

  /**
   * The state a fresh checkout is in, and it reports now. Every entry falls
   * back to the mock's key, and under the pull model that key is what lets a
   * runner claim work — so the finding is true even in development, and saying
   * so is the point: production refuses the same boot outright, and somebody
   * should have met this on their own machine first. The copy carries that
   * reassurance rather than the check suppressing it.
   */
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
