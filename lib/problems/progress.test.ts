import { describe, expect, it, vi } from "vitest";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { db } from "@/lib/db";
import { openContestProblem, viewerWith } from "@/test/content-shapes";
import { progressFor } from "./progress";
vi.mock("@/lib/db", () => ({ db: { select: vi.fn() } }));
vi.mock("./views", () => ({ viewsFor: () => ({}) }));

describe("进度查询前置条件", () => {
  it("游客和全题单缺少解释时不访问数据库", async () => {
    const { contest } = openContestProblem();
    expect(await progressFor([contest.slug], ANONYMOUS)).toEqual(new Map());
    expect(await progressFor([contest.slug], viewerWith("submission.read"))).toEqual(new Map());
    expect(db.select).not.toHaveBeenCalled();
  });
});
