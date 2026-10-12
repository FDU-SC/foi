import { createElement } from "react";
import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import {
  at,
  CONTEST,
  input,
  participants,
  problem,
  submission,
  unjudged,
} from "@/test/standings-support";
import type { RulesetRenderers } from "@/lib/standings/types";
import type { PracticeCell } from "./practice";
import { renderers, ruleset } from "./practice";

function compute(options: Parameters<typeof input>[0]) {
  return ruleset.compute(input(options));
}

function cell(standings: ReturnType<typeof compute>, uid: number, key: string) {
  return standings.rows.find((row) => row.participant.uid === uid)?.cells[key] as PracticeCell | undefined;
}

function scored(uid: number, key: string, minutes: number, score: number, maxScore = 100) {
  return submission({ uid, problemKey: key, minutes, score, maxScore });
}

const problems = [problem("a", "A"), { ...problem("b", "B"), points: 50 }];

describe("practice 计分", () => {
  it("每题取最高分，按比赛给的分值折算", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [scored(1, "a", 10, 40), scored(1, "a", 20, 90), scored(1, "a", 30, 60), scored(1, "b", 40, 5, 10)],
    });

    expect(cell(standings, 1, "a")?.score).toBe(90);
    expect(cell(standings, 1, "b")?.score).toBe(25);
    expect(standings.rows[0].total).toBe(115);
  });

  it("结果不带分数时记 0 分，负分按 0 分算", () => {
    const standings = compute({
      participants: participants(1),
      problems,
      submissions: [
        { ...scored(1, "a", 10, 0), result: { accepted: false } },
        scored(1, "b", 20, -5),
      ],
    });

    expect(standings.rows[0].total).toBe(0);
    expect(cell(standings, 1, "a")?.attempts).toBe(1);
  });

  it("同分时先达到最高分的人在前，零分不推进时刻", () => {
    const standings = compute({
      participants: participants(1, 2),
      problems,
      submissions: [scored(1, "a", 30, 100), scored(2, "a", 10, 100), scored(2, "b", 90, 0)],
    });

    expect(standings.rows.map((row) => row.participant.uid)).toEqual([2, 1]);
    expect(standings.rows[0].tiebreak).toBe(at(10).getTime());
  });
});

describe("practice 解题、提交与首杀", () => {
  it("通过计入解题，首杀归最早通过的人，未判完的只记待定", () => {
    const standings = compute({
      participants: participants(1, 2),
      problems,
      submissions: [
        scored(2, "a", 5, 30),
        scored(1, "a", 10, 100),
        scored(2, "a", 20, 100),
        unjudged(2, "b", 25),
      ],
    });

    expect(cell(standings, 1, "a")).toMatchObject({ solved: true, firstBlood: true, attempts: 1 });
    expect(cell(standings, 2, "a")).toMatchObject({ solved: true, firstBlood: false, attempts: 2 });
    expect(cell(standings, 2, "b")).toMatchObject({ attempts: 0, pending: 1, score: 0 });
  });

  it("汇总榜按行列出解题数、提交次数与首杀，并标出自己", () => {
    const standings = compute({
      participants: participants(1, 2),
      problems,
      submissions: [scored(1, "a", 10, 100), scored(2, "a", 20, 100), scored(2, "b", 30, 20, 50)],
    });
    const Board = renderers.Board;
    const html = renderToStaticMarkup(
      createElement(Board, { board: { standings, renderers: renderers as RulesetRenderers }, problems, highlight: 2 }),
    );

    expect(html).toContain("解题数");
    expect(html).toContain("首杀");
    expect(html).toContain("（我）");
    expect(html.match(/aria-current="true"/g)).toHaveLength(1);
  });

  it("不同比赛里的同一道题各自计分、各自首杀", () => {
    const later = { slug: "later", startsAt: at(0), endsAt: at(300) };
    const standings = compute({
      participants: participants(1, 2),
      problems: [problem("a", "A"), { ...problem("later-a", "A", 100, later.slug) }],
      contests: [{ slug: CONTEST, startsAt: at(0), endsAt: at(300) }, later],
      submissions: [
        scored(1, "a", 10, 100),
        submission({ uid: 2, problemKey: "later-a", contestSlug: later.slug, minutes: 20, score: 100 }),
      ],
    });

    expect(cell(standings, 1, "a")?.firstBlood).toBe(true);
    expect(cell(standings, 2, "later-a")?.firstBlood).toBe(true);
  });
});
