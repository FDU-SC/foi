import "server-only";
import { sql } from "drizzle-orm";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { catalogueSlugs } from "@/lib/contests/catalogue";
import { contestPhase } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { problemsFor } from "@/lib/problems/access";
import { ACCEPTED_FIELD, ACCEPTED_VALUE } from "../_shared/verdicts";

export interface LeaderboardRow {
  uid: number;
  username: string;
  nickname: string;
  submissions: number;
  solved: number;
  firstBloods: number;
}

/** Public practice only. All timestamps and access decisions share one clock. */
export async function leaderboardRows(limit = 50, now = new Date()): Promise<LeaderboardRow[]> {
  const pairs = catalogueSlugs().flatMap((slug) => {
    const contest = contestFor(slug, ANONYMOUS, now)?.config;
    if (!contest || contestPhase(contest, now) === "frozen") return [];
    return problemsFor(slug, ANONYMOUS, now).map(({ ref }) =>
      sql`(s.contest_slug = ${slug} and s.problem_slug = ${ref.problem.slug}
        and s.created_at >= ${contest.startsAt.toISOString()}::timestamptz)`);
  });
  if (pairs.length === 0 || limit <= 0) return [];
  const rows = await db.execute(sql`
    with eligible as (
      select s.id, s.uid, s.problem_slug, s.created_at,
        s.result -> ${ACCEPTED_FIELD} = ${JSON.stringify(ACCEPTED_VALUE)}::jsonb as accepted
      from submissions s join accounts a on a.uid = s.uid
      where a.status = 'active' and s.state = 'completed'
        and s.created_at <= ${now.toISOString()}::timestamptz
        and (${sql.join(pairs, sql` or `)})
    ), counts as (
      select uid, count(*)::int as submissions from eligible group by uid
    ), solved_problems as (
      select uid, problem_slug, min(created_at) as solved_at
      from eligible where accepted group by uid, problem_slug
    ), scores as (
      select uid, count(*)::int as solved, max(solved_at) as reached_at
      from solved_problems group by uid
    ), first_solves as (
      select distinct on (problem_slug) uid from eligible where accepted
      order by problem_slug, created_at, id
    ), first_bloods as (
      select uid, count(*)::int as total from first_solves group by uid
    )
    select a.uid, a.username, a.nickname, c.submissions,
      coalesce(sc.solved, 0)::int as solved,
      coalesce(f.total, 0)::int as "firstBloods"
    from counts c join accounts a on a.uid = c.uid
    left join scores sc on sc.uid = c.uid
    left join first_bloods f on f.uid = c.uid
    order by solved desc, sc.reached_at asc nulls last, a.uid asc
    limit ${limit}
  `);
  return rows.rows as unknown as LeaderboardRow[];
}
