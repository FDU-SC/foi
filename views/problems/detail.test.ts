import { afterEach, describe, expect, it, vi } from "vitest";
import { isCatalogue } from "@/lib/contests/catalogue";
import { contestProblemRefs } from "@/lib/contests/refs";
import {
  CataloguedProblemView,
  ProblemDetailView,
  cataloguedProblemParams,
  problemDetailParams,
} from "./detail";

import type { ResolvedUser } from "@/lib/accounts/types";
import type { ProblemContextValue } from "@/components/problem/problem-context";
import type { ContestProblemRef } from "@/lib/authz/resources";
import { viewerFor, type Viewer } from "@/lib/authz/viewer";
import { contestProblemRef } from "@/lib/contests/refs";
import { submitFor } from "@/lib/submissions/gate";
import { invokeFor } from "@/lib/problems/actions";
import { permissionFor } from "@/lib/authz/adapters";
import { isInlineBackend } from "@/lib/problems/types";
import { archivedProblem, contestWithGroupEntry, independentProblemPermissions, inlineProblem, upcomingProblem, upsolveProblem, viewerWith } from "@/test/content-shapes";

const auth = vi.hoisted(() => ({ getResolvedUser: vi.fn<() => Promise<ResolvedUser | null>>() }));
vi.mock("@/auth", () => auth);
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function permissions(ref: ContestProblemRef, viewer: Viewer): Promise<ProblemContextValue["permissions"]> {
  auth.getResolvedUser.mockResolvedValue(viewer.authenticated ? {
    uid: viewer.uid!, groups: [...viewer.groups], username: "reader", nickname: "读者",
    avatarUpdatedAt: null, email: null, emailVerified: false, status: "active", disabled: false,
  } : null);
  const page = isCatalogue(ref.contest.slug)
    ? await CataloguedProblemView({ params: Promise.resolve({ section: ref.contest.slug, problem: ref.problem.slug }), searchParams: Promise.resolve({}) })
    : await ProblemDetailView({ params: Promise.resolve({ slug: ref.contest.slug, problem: ref.problem.slug }), searchParams: Promise.resolve({}) });
  const value: ProblemContextValue = page.props.value;
  expect(value.contestSlug).toBe(ref.contest.slug);
  expect(value.config).not.toHaveProperty("backend");
  expect(value).not.toHaveProperty("canAct");
  expect(value).not.toHaveProperty("blocked");
  const gate = submitFor(ref.contest.slug, ref.problem.slug, viewer);
  expect(value.permissions.submit).toEqual(permissionFor(gate.ok ? null : gate.denial));
  if (!isInlineBackend(ref.problem.backend)) {
    for (const action of Object.keys(ref.problem.backend.actions)) {
      const invocation = invokeFor(ref.contest.slug, ref.problem.slug, action, viewer);
      expect(invocation.kind).not.toBe("missing");
      expect(value.permissions.actions[action]).toEqual(permissionFor(invocation.kind === "denied" ? invocation.denial : null));
    }
  }
  return value.permissions;
}


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

describe("题面操作预检", () => {
  it("可读题但不在参赛名单的人不能提交或交互", async () => {
    const { contest, entry, group } = contestWithGroupEntry();
    vi.useFakeTimers();
    vi.setSystemTime(new Date(contest.startsAt.getTime() + 60_000));
    const ref = contestProblemRef(contest.slug, entry.slug)!;
    expect(isCatalogue(contest.slug)).toBe(false);
    const outside = await permissions(ref, viewerFor({ uid: 100, groups: [] }));
    expect(outside.submit).toMatchObject({ allowed: false, reason: { code: "not-entered" } });
    expect(Object.values(outside.actions).length).toBeGreaterThan(0);
    for (const action of Object.values(outside.actions)) expect(action).toMatchObject({ allowed: false, reason: { code: "not-entered" } });
    const entrant = await permissions(ref, viewerFor({ uid: 100, groups: [group] }));
    expect(entrant.submit.allowed).toBe(true);
    const anonymous = await permissions(ref, viewerFor(null));
    expect(anonymous.submit).toMatchObject({ allowed: false, reason: { code: "unauthenticated" } });
  });

  it("题库入口分别传递提交和各动作的权限", async () => {
    const { ref, submitOnly, invokeOnly, partial, allowedAction, deniedAction } = independentProblemPermissions();
    expect(isCatalogue(ref.contest.slug)).toBe(true);
    const first = await permissions(ref, submitOnly);
    expect(first.submit.allowed).toBe(true);
    expect(first.actions[allowedAction]?.allowed).toBe(false);
    const second = await permissions(ref, invokeOnly);
    expect(second.submit.allowed).toBe(false);
    expect(second.actions[deniedAction]?.allowed).toBe(true);
    const third = await permissions(ref, partial);
    expect(third.actions[allowedAction]?.allowed).toBe(true);
    expect(third.actions[deniedAction]?.allowed).toBe(false);
    expect(third.actions["unknown-action"]).toBeUndefined();
  });

  it("预览不绕过开赛时间，赛后按比赛配置决定是否允许操作", async () => {
    const preview = await permissions(upcomingProblem(), viewerWith("problem.read"));
    expect(preview.submit).toMatchObject({ allowed: false, reason: { code: "contest-closed" } });
    const viewer = viewerFor({ uid: 100, groups: [] });
    const closed = await permissions(archivedProblem(), viewer);
    expect(closed.submit).toMatchObject({ allowed: false, reason: { code: "contest-closed" } });
    const practice = await permissions(upsolveProblem(), viewer);
    expect(practice.submit.allowed).toBe(true);
  });

  it("内联题目不向客户端提供交互动作", async () => {
    const result = await permissions(inlineProblem(), viewerFor({ uid: 100, groups: [] }));
    expect(result.actions).toEqual({});
  });
});
