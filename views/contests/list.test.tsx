import { afterEach, describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { getViewer } from "@/auth";
import { contestsFor, type ContestView } from "@/lib/contests/access";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { contestConfigSchema } from "@/lib/contests/types";
import { ContestListView } from "./list";

vi.mock("@/auth", () => ({
  getViewer: vi.fn().mockResolvedValue({
    uid: null,
    groups: [],
    authenticated: false,
  }),
}));
vi.mock("@/lib/contests/access", () => ({
  contestsFor: vi.fn(),
}));
vi.mock("@/lib/contests/catalogue", () => ({
  contestHref: (slug: string) => `/contests/${slug}`,
  isCatalogue: (slug: string) => slug === "catalogue",
  standingsHref: (slug: string) => `/contests/${slug}/standings`,
}));
vi.mock("@/lib/standings/registry", () => ({
  rulesetFor: () => ({ name: "测试赛制" }),
}));
vi.mock("@/components/contests/countdown", () => ({
  ContestCountdown: ({
    target,
    refreshAt,
  }: {
    target: number;
    refreshAt?: number;
  }) => (
    <span data-countdown-target={target} data-countdown-refresh={refreshAt}>
      倒计时
    </span>
  ),
}));

const NOW = new Date("2030-01-01T00:00:00Z");

function contest(
  slug: string,
  title: string,
  startsInMinutes: number,
  endsInMinutes: number,
  freezeInMinutes?: number,
): ContestView {
  return {
    config: contestConfigSchema.parse({
      slug,
      title,
      leaderboards: [
        { id: "main", title: "排行榜", ruleset: { id: "test" } },
      ],
      startsAt: new Date(+NOW + startsInMinutes * 60_000).toISOString(),
      endsAt: new Date(+NOW + endsInMinutes * 60_000).toISOString(),
      freezeAt:
        freezeInMinutes === undefined
          ? undefined
          : new Date(+NOW + freezeInMinutes * 60_000).toISOString(),
    }),
    preview: false,
  };
}

const running = contest("running", "进行中的比赛", -60, 60, 10);
const frozen = contest("frozen", "封榜中的比赛", -60, 60, -10);
const upcoming = contest("upcoming", "未开始的比赛", 60, 120);
const ended = contest("ended", "已结束的比赛", -120, -60);
const catalogued = contest("catalogue", "题库分区", -60, 60);

afterEach(() => {
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("比赛列表筛选", () => {
  it("进行中筛选包含封榜比赛，并在封榜边界刷新焦点比赛", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(getViewer).mockResolvedValue(ANONYMOUS);
    vi.mocked(contestsFor).mockReturnValue([
      running,
      frozen,
      upcoming,
      ended,
      catalogued,
    ]);

    const html = renderToStaticMarkup(
      await ContestListView({
        searchParams: Promise.resolve({ status: "running" }),
      }),
    );

    expect(contestsFor).toHaveBeenCalledWith(ANONYMOUS, NOW);
    expect(html).toContain("进行中的比赛");
    expect(html).toContain("封榜中的比赛");
    expect(html).not.toContain("未开始的比赛");
    expect(html).not.toContain("已结束的比赛");
    expect(html).not.toContain("题库分区");
    expect(html).toContain(
      `data-countdown-target="${running.config.endsAt.getTime()}"`,
    );
    expect(html).toContain(
      `data-countdown-refresh="${running.config.freezeAt?.getTime()}"`,
    );
  });

  it("无效或重复的状态参数回退到全部比赛", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
    vi.mocked(contestsFor).mockReturnValue([
      running,
      frozen,
      upcoming,
      ended,
      catalogued,
    ]);

    for (const status of ["unknown", ["running", "ended"]]) {
      const html = renderToStaticMarkup(
        await ContestListView({
          searchParams: Promise.resolve({ status }),
        }),
      );

      expect(html).toContain("进行中的比赛");
      expect(html).toContain("封榜中的比赛");
      expect(html).toContain("未开始的比赛");
      expect(html).toContain("已结束的比赛");
      expect(html).not.toContain("题库分区");
    }
  });
});
