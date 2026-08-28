import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { listRules } from "@/lib/enrollment/registry";
import { isUidsRule } from "@/lib/enrollment/types";
import { isPrivileged } from "@/lib/permissions/groups";

function reservedUid(): number {
  const source = readFileSync(
    join(process.cwd(), "scripts", "demo-seed.cjs"),
    "utf8",
  );
  const match = source.match(/^const RESERVED_UID = (\d+);$/m);
  expect(match, "scripts/demo-seed.cjs 里读不到 RESERVED_UID").not.toBeNull();

  return Number(match![1]);
}

function privilegedUids(): number[] {
  const uids = new Set<number>();

  for (const rule of listRules()) {
    if (!isUidsRule(rule)) continue;
    if (!rule.groups.some(isPrivileged)) continue;
    for (const uid of rule.uids) uids.add(uid);
  }

  return [...uids].sort((a, b) => a - b);
}

describe("演示账号拿不到带权限的 uid", () => {
  it("分流规则点名的 uid 正是 demo-seed 占住的那个", () => {
    expect(
      privilegedUids(),
      "demo-seed.cjs 是 CommonJS，读不到 content，只能硬编码一个 uid 去占位。" +
        "两处对不上，db-reset 之后第一个演示账号就会顺位捡到管理员权限，" +
        "而它的密码公示在首页。",
    ).toEqual([reservedUid()]);
  });
});
