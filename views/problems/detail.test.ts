import { describe, expect, it, vi } from "vitest";
import { isCatalogue } from "@/lib/contests/catalogue";
import { contestProblemRefs } from "@/lib/contests/refs";
import {
  cataloguedProblemParams,
  problemDetailParams,
} from "./detail";

vi.mock("@/auth", () => ({ getResolvedUser: vi.fn() }));

const pair = (contest: string, problem: string) => `${contest}/${problem}`;

describe("题目详情页的静态参数", () => {
  it("两套路由完整且不重叠地分配每一对比赛与题目", () => {
    const refs = contestProblemRefs();
    const ordinaryParams = problemDetailParams();
    const cataloguedParams = cataloguedProblemParams();

    const ordinary = ordinaryParams.map(({ slug, problem }) =>
      pair(slug, problem),
    );
    const catalogued = cataloguedParams.map(({ section, problem }) =>
      pair(section, problem),
    );

    const expectedOrdinary = refs
      .filter((ref) => !isCatalogue(ref.contest.slug))
      .map((ref) => pair(ref.contest.slug, ref.problem.slug));
    const expectedCatalogued = refs
      .filter((ref) => isCatalogue(ref.contest.slug))
      .map((ref) => pair(ref.contest.slug, ref.problem.slug));

    expect(ordinary.length, "夹具没有覆盖 /contests 路由").toBeGreaterThan(0);
    expect(catalogued.length, "夹具没有覆盖 /problems 路由").toBeGreaterThan(0);
    expect(ordinary).toEqual(expectedOrdinary);
    expect(catalogued).toEqual(expectedCatalogued);
    expect(new Set(ordinary).intersection(new Set(catalogued))).toEqual(
      new Set(),
    );
    expect([...ordinary, ...catalogued]).toHaveLength(refs.length);
  });
});
