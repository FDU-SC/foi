import { sql } from "drizzle-orm";
import { db } from "@/lib/db";

/**
 * 全局排行榜与个人题目状态的统计。
 *
 * 平台不解释 result 的业务含义，但 `accepted` 是判题机（内容层的 judge 模板与
 * 评测机）约定产出的布尔标志——平台只消费这一个字段做全局统计与状态展示，
 * 不读其他任何字段。它和 `lib/presentation.ts` 读 `result.status` 做展示是同一
 * 层级的机制，不是计分规则。
 */
export function isAcceptedResult(result: unknown): boolean {
  return (
    typeof result === "object" &&
    result !== null &&
    (result as { accepted?: unknown }).accepted === true
  );
}

export interface LeaderboardRow {
  uid: number;
  username: string;
  nickname: string;
  /** 提交总次数（含所有结果）。 */
  submissions: number;
  /** 通过的提交次数。 */
  accepted: number;
  /** 解出的题目数（去重）。 */
  solved: number;
  /** 首杀数：第一个 AC 一道题的次数。 */
  firstBloods: number;
}

interface AggRow {
  uid: number;
  username: string;
  nickname: string;
  submissions: number;
  accepted: number;
  solved: number;
}

interface FirstBloodRow {
  uid: number;
  first_bloods: number;
}

/**
 * 全局排行榜：按解出题数降序、提交次数升序、uid 升序排列。
 *
 * 只统计至少提交过一次的账号。首杀单独聚合：每道题第一条 accepted 提交的
 * 作者记一次首杀。
 */
export async function leaderboardRows(limit = 50): Promise<LeaderboardRow[]> {
  const [aggregate, firstBloods] = await Promise.all([
    db.execute(sql`
      select
        a.uid,
        a.username,
        a.nickname,
        count(s.id)::int as submissions,
        count(s.id) filter (where s.result->>'accepted' = 'true')::int as accepted,
        count(distinct s.problem_slug) filter (where s.result->>'accepted' = 'true')::int as solved
      from accounts a
      join submissions s on s.uid = a.uid
      group by a.uid, a.username, a.nickname
      order by solved desc, submissions asc, a.uid asc
      limit ${limit}
    `),
    db.execute(sql`
      select uid, count(*)::int as first_bloods
      from (
        select distinct on (s.problem_slug) s.uid
        from submissions s
        where s.result->>'accepted' = 'true'
        order by s.problem_slug, s.judged_at asc nulls last, s.created_at asc
      ) f
      group by uid
    `),
  ]);

  const firstBloodByUid = new Map(
    (firstBloods.rows as unknown as FirstBloodRow[]).map((row) => [
      row.uid,
      row.first_bloods,
    ]),
  );

  return (aggregate.rows as unknown as AggRow[]).map((row) => ({
    uid: row.uid,
    username: row.username,
    nickname: row.nickname,
    submissions: row.submissions,
    accepted: row.accepted,
    solved: row.solved,
    firstBloods: firstBloodByUid.get(row.uid) ?? 0,
  }));
}

export interface ProblemStatus {
  /** 最近一次提交的 result.status；accepted 时固定为 "accepted"。 */
  status: string | null;
  accepted: boolean;
}

/**
 * 从一组提交记录里算每道题的个人状态：
 * - 该题有过 accepted → 显示 AC
 * - 否则 → 最近一次提交的 status（PC / WA / CE / …）
 *
 * 纯函数，便于测试；调用方负责把「自己的提交」喂进来。
 */
export function computeProblemStatuses(
  submissions: {
    problemSlug: string;
    result: unknown;
    createdAt: Date | string;
  }[],
): Map<string, ProblemStatus> {
  const latest = new Map<string, { at: number; status: string | null }>();
  const accepted = new Set<string>();

  for (const submission of submissions) {
    const at = new Date(submission.createdAt).getTime();
    if (isAcceptedResult(submission.result)) {
      accepted.add(submission.problemSlug);
    }
    const seen = latest.get(submission.problemSlug);
    if (!seen || at > seen.at) {
      const status =
        typeof submission.result === "object" &&
        submission.result !== null &&
        typeof (submission.result as { status?: unknown }).status === "string"
          ? ((submission.result as { status: string }).status)
          : null;
      latest.set(submission.problemSlug, { at, status });
    }
  }

  const out = new Map<string, ProblemStatus>();
  for (const slug of new Set([...accepted, ...latest.keys()])) {
    out.set(slug, {
      status: accepted.has(slug) ? "accepted" : (latest.get(slug)?.status ?? null),
      accepted: accepted.has(slug),
    });
  }
  return out;
}
