import { spawnSync } from "node:child_process";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const ROOT = join(import.meta.dirname, "..");

/**
 * The patch rewrites this repository's own content by exact source pattern, so
 * a sample invented here would only prove the patterns match the sample. These
 * are the real files, copied so the run has somewhere to write.
 */
const PATCHED = [
  "content/site.ts",
  "content/contests/demo-ctf/contest.ts",
  "content/enrollment/example.ts",
  "scripts/demo-config.cjs",
];

const ENROLLMENT = "content/enrollment/example.ts";

/** A rule that names accounts by uid instead of by address. */
const UID_KEYED = /^\s*uids:/m;

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function applyPatch(): (path: string) => string {
  const root = mkdtempSync(join(tmpdir(), "foi-demo-config-"));
  roots.push(root);

  for (const path of PATCHED) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    copyFileSync(join(ROOT, path), join(root, path));
  }

  const run = spawnSync(process.execPath, [join(root, "scripts/demo-config.cjs")], {
    env: {
      ...process.env,
      FOI_DEMO_PASSWORD: "public-password",
      FOI_DEMO_ACCOUNT_COUNT: "5",
    },
    encoding: "utf8",
  });

  expect(run.status, `${run.stdout}${run.stderr}`).toBe(0);

  return (path) => readFileSync(join(root, path), "utf8");
}

describe("demo 配置补丁", () => {
  it("演示站的报名规则里不留按 uid 分配的用户组", () => {
    const read = applyPatch();

    expect(
      UID_KEYED.test(read(ENROLLMENT)),
      "演示账号的密码是公开的，按 uid 分配的用户组会跟着账号顺序落到它们身上",
    ).toBe(false);
  });

  it("补丁前确实有按 uid 分配的用户组可删", () => {
    expect(
      UID_KEYED.test(readFileSync(join(ROOT, ENROLLMENT), "utf8")),
      "没有可删的规则，上一条就是空真",
    ).toBe(true);
  });
});
