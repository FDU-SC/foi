import { beforeEach, describe, expect, it, vi } from "vitest";
import { ANONYMOUS, viewerFor } from "@/lib/authz/viewer";
import { allContests } from "@/lib/contests/registry";
import { contestProblemRefs } from "@/lib/contests/refs";
import { catalogueSlugs } from "@/lib/contests/catalogue";
import { problemFor } from "@/lib/problems/access";
import { submissionsFor } from "@/lib/submissions/access";
import type { SubmissionListItem } from "@/lib/submissions/types";
import { homeSubmissions, recentContests, recentPractice } from "./home";

vi.mock("@/lib/submissions/access", () => ({
  submissionsFor: vi.fn().mockResolvedValue([]),
}));
vi.mock("@/lib/problems/access", () => ({ problemFor: vi.fn() }));
const viewer = viewerFor({ uid: 321, groups: [] });
const now = new Date("2030-01-01T00:00:00Z");
beforeEach(() => vi.clearAllMocks());

describe("主页数据", () => {
  it("游客不查提交，拥有额外权限的用户仍显式限制本人及最近50条", async () => {
    expect(await homeSubmissions(ANONYMOUS)).toEqual([]);
    expect(submissionsFor).not.toHaveBeenCalled();
    await homeSubmissions(viewer);
    expect(submissionsFor).toHaveBeenCalledWith(viewer, {
      uid: viewer.uid,
      limit: 50,
    });
  });
  it("练习按比赛和题目去重，排除非题库和不可读取的题目", () => {
    const refs = contestProblemRefs().filter((ref) =>
      catalogueSlugs().includes(ref.contest.slug),
    );
    const first = refs[0];
    expect(first).toBeDefined();
    const row = (
      id: string,
      contestSlug = first.contest.slug,
      problemSlug = first.problem.slug,
    ): SubmissionListItem => ({
      id,
      contestSlug,
      problemSlug,
      problemTitle: "题目",
      uid: 321,
      nickname: "用户",
      state: "completed",
      result: { arbitrary: [1, 2] },
      detail: null,
      reason: null,
      runnerStatus: null,
      createdAt: now.toISOString(),
      judgedAt: null,
      queue: null,
    });
    vi.mocked(problemFor).mockImplementation((contest, problem) =>
      problem === first.problem.slug
        ? {
            ref: { ...first, contest: { ...first.contest, slug: contest } },
            preview: false,
          }
        : undefined,
    );
    const other = catalogueSlugs().find((slug) => slug !== first.contest.slug)!;
    const rows = [
      row("latest"),
      row("duplicate"),
      row("same-problem-other-round", other),
      row("sealed", first.contest.slug, "inaccessible"),
      row("not-catalogue", "not-mounted"),
    ];
    expect(
      recentPractice(rows, viewer, now).map((item) => item.row.id),
    ).toEqual(["latest", "same-problem-other-round"]);
    expect(problemFor).toHaveBeenCalledWith(
      first.contest.slug,
      first.problem.slug,
      viewer,
      now,
    );
    expect(recentPractice([], viewer, now)).toEqual([]);
  });
  it("比赛先进行中（含封榜）、再未开始、再已结束，各自按正确时间排序", () => {
    const base = allContests()[0];
    const event = (
      slug: string,
      start: number,
      end: number,
      freeze?: number,
    ) => ({
      config: {
        ...base,
        slug,
        startsAt: new Date(+now + start),
        endsAt: new Date(+now + end),
        freezeAt: freeze === undefined ? undefined : new Date(+now + freeze),
      },
    });
    const ended = event("ended", -20000, -10000);
    const upcoming = event("upcoming", 10000, 20000);
    const running = event("running", -10000, 5000);
    const frozen = event("frozen", -10000, 2000, -1000);
    expect(
      recentContests([ended, upcoming, running, frozen], now).map(
        (x) => x.config.slug,
      ),
    ).toEqual(["frozen", "running", "upcoming"]);
    expect(
      recentContests(
        [
          event("later", 2000, 9000),
          event("sooner", 1000, 9000),
          event(catalogueSlugs()[0], -10000, 4000),
        ],
        now,
      ).map((x) => x.config.slug),
    ).toEqual(["sooner", "later"]);
    expect(
      recentContests([event("older", -30000, -20000), ended], now).map(
        (x) => x.config.slug,
      ),
    ).toEqual(["ended", "older"]);
    expect(recentContests([], now)).toEqual([]);
  });
});
