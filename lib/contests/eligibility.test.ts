import { describe, expect, it } from "vitest";
import type { ResolvedUser } from "@/lib/accounts/types";
import { canEnterContest } from "./access";
import { contestConfigSchema, type ContestConfig } from "./types";

function contest(
  participants: ContestConfig["participants"],
): ContestConfig {
  return contestConfigSchema.parse({
    slug: "test",
    title: "Test",
    ruleset: { id: "acm" },
    startsAt: "2026-01-15T13:00:00+08:00",
    endsAt: "2026-01-15T18:00:00+08:00",
    problems: [],
    participants,
  });
}

function user(
  handle: string,
  groups: string[],
): Pick<ResolvedUser, "handle" | "groups"> {
  return { handle, groups };
}

describe("canEnterContest", () => {
  it("open 放行任何人", () => {
    expect(canEnterContest(contest({ mode: "open" }), user("nobody", []))).toBe(
      true,
    );
  });

  it("group 只放行属于该组的人", () => {
    const c = contest({ mode: "group", group: "2026-校队" });

    expect(canEnterContest(c, user("alice", ["2026-校队"]))).toBe(true);
    expect(canEnterContest(c, user("bob", ["2025-校队"]))).toBe(false);
    expect(canEnterContest(c, user("carol", []))).toBe(false);
  });

  it("list 只放行名单上的 handle", () => {
    const c = contest({ mode: "list", handles: ["alice", "bob"] });

    expect(canEnterContest(c, user("alice", []))).toBe(true);
    expect(canEnterContest(c, user("carol", []))).toBe(false);
  });

  it("list 的比对大小写不敏感，与账号表的规范化一致", () => {
    const c = contest({ mode: "list", handles: ["Alice"] });

    expect(canEnterContest(c, user("alice", []))).toBe(true);
    expect(canEnterContest(c, user("ALICE", []))).toBe(true);
  });

  it("组名匹配是精确的，不做前缀或包含", () => {
    const c = contest({ mode: "group", group: "2026级" });

    expect(canEnterContest(c, user("alice", ["2026级本科生"]))).toBe(false);
  });
});
