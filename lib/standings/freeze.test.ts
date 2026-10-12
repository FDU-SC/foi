import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ANONYMOUS, viewerFor, type Viewer } from "@/lib/authz/viewer";
import * as catalogue from "@/lib/contests/catalogue";
import * as contests from "@/lib/contests/registry";
import { pairKey, type ContestConfig } from "@/lib/contests/types";
import { openContestProblem, viewerWith } from "@/test/content-shapes";
import { invalidateStandings } from "./cache";
import { catalogueStandingsFor, standingsFor } from "./compute";
import { rulesetFor } from "./registry";

const query = vi.hoisted(() => ({ orderBy: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { select: () => ({ from: () => ({ innerJoin: () => ({ where: () => query }) }) }) },
}));

const freezeAt = new Date("2030-01-01T04:00:00Z");
const { contest: base, problem } = openContestProblem(freezeAt);
const frozen: ContestConfig = {
  ...base,
  startsAt: new Date("2030-01-01T00:00:00Z"),
  endsAt: new Date("2030-01-01T05:00:00Z"),
  freezeAt,
};
const clear: ContestConfig = { ...frozen, slug: "kernel-unfrozen", freezeAt: undefined };
const duringFreeze = new Date(freezeAt.getTime() + 60_000);

function row(contest: ContestConfig, offset: number) {
  return {
    id: `${contest.slug}:${offset}`,
    uid: 1,
    contestSlug: contest.slug,
    problemSlug: problem.slug,
    state: "completed" as const,
    result: { opaque: [offset, "result"] },
    createdAt: new Date(freezeAt.getTime() + offset),
    username: "participant",
    nickname: "Participant",
    avatarUpdatedAt: null,
  };
}

const rows = [-1, 0, 1].map((offset) => row(frozen, offset));
const ruleset = rulesetFor(frozen.leaderboards[0].ruleset.id)!;

beforeEach(() => {
  vi.spyOn(contests, "contestBySlug").mockImplementation((slug) =>
    [frozen, clear].find((contest) => contest.slug === slug));
  vi.spyOn(catalogue, "catalogueBoardSections").mockReturnValue([frozen.slug]);
  query.orderBy.mockResolvedValue(rows);
});

afterEach(() => {
  invalidateStandings(frozen.slug);
  invalidateStandings(clear.slug);
  vi.restoreAllMocks();
});

describe.each(["contest", "catalogue"] as const)("%s 封榜计算入口", (entry) => {
  async function read(viewer: Viewer, now = duringFreeze) {
    const compute = vi.spyOn(ruleset, "compute").mockReturnValue({ rows: [], totalLabel: "" });
    compute.mockClear();
    const board = entry === "contest"
      ? await standingsFor(frozen.slug, viewer, now)
      : await catalogueStandingsFor({}, viewer, now);
    expect(board).not.toBeNull();
    return { board, submissions: compute.mock.lastCall?.[0].submissions };
  }

  it("公开视角保留封榜前结果，屏蔽封榜时刻及之后的结果", async () => {
    const original = structuredClone(rows);
    const { board, submissions } = await read(ANONYMOUS);
    expect(board?.frozen).toBe(true);
    expect(submissions).toEqual(rows.map((source, index) => ({
      id: source.id,
      uid: source.uid,
      contestSlug: source.contestSlug,
      problemKey: pairKey(source.contestSlug, source.problemSlug),
      state: source.state,
      createdAt: source.createdAt,
      result: index === 0 ? source.result : null,
    })));
    expect(rows).toEqual(original);
  });

  it("未封榜视角不污染普通选手的缓存", async () => {
    const privileged = await read(viewerWith("standings.readUnfrozen"));
    expect(privileged.submissions?.map(({ result }) => result)).toEqual(rows.map(({ result }) => result));

    const player = await read(viewerFor({ uid: 1, groups: [] }));
    expect(player.submissions?.map(({ result }) => result)).toEqual([rows[0].result, null, null]);
  });

  it("比赛结束后恢复全部结果", async () => {
    await read(ANONYMOUS);
    const { board, submissions } = await read(ANONYMOUS, new Date(frozen.endsAt.getTime() + 1));
    expect(board?.frozen).toBe(false);
    expect(submissions?.map(({ result }) => result)).toEqual(rows.map(({ result }) => result));
  });
});

it("题库榜按各分区的封榜状态屏蔽，同题在其他分区的结果不受影响", async () => {
  const other = row(clear, 1);
  query.orderBy.mockResolvedValue([...rows, other]);
  vi.mocked(catalogue.catalogueBoardSections).mockReturnValue([frozen.slug, clear.slug]);
  const compute = vi.spyOn(ruleset, "compute").mockReturnValue({ rows: [], totalLabel: "" });

  const board = await catalogueStandingsFor({}, ANONYMOUS, duringFreeze);

  expect(board?.sections.map(({ slug }) => slug)).toEqual([frozen.slug, clear.slug]);
  expect(compute.mock.lastCall?.[0].submissions.map(({ id, result }) => [id, result])).toEqual([
    [rows[0].id, rows[0].result],
    [rows[1].id, null],
    [rows[2].id, null],
    [other.id, other.result],
  ]);
});
