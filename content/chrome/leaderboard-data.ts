import "server-only";
import { sql } from "drizzle-orm";
import { ANONYMOUS } from "@/lib/authz/viewer";
import { contestFor } from "@/lib/contests/access";
import { catalogueSlugs, catalogueLeaderboards } from "@/lib/contests/catalogue";
import { contestPhase } from "@/lib/contests/types";
import { db } from "@/lib/db";
import { problemsFor } from "@/lib/problems/access";
import { ACCEPTED_FIELD, ACCEPTED_VALUE } from "../_shared/verdicts";

export interface LeaderboardRow {
  rank: number;
  total: number;
  uid: number;
  username: string;
  nickname: string;
  submissions: number;
  solved: number;
  firstBloods: number;
}

/** Public practice only. All timestamps and access decisions share one clock. */
export async function leaderboardRows(
  limit = 50,
  now = new Date(),
  board?: string,
): Promise<LeaderboardRow[]> {
  const boards = catalogueLeaderboards();
  const selected = boards.filter((item) =>
    board === undefined ? item.includeInTotal : item.id === board,
  );
  const sections = new Set(selected.flatMap((item) => item.sections));
  const slugs = catalogueSlugs().filter((slug) =>
    (boards.length === 0 && board === undefined) || sections.has(slug),
  );
  const pairs = slugs.flatMap((slug) => {
    const contest = contestFor(slug, ANONYMOUS, now)?.config;
    if (!contest || contestPhase(contest, now) === "frozen") return [];
    return problemsFor(slug, ANONYMOUS, now).map(({ ref }) =>
      sql`(${slug}::text, ${ref.problem.slug}::text, ${ref.entry.points ?? ref.problem.maxScore}::numeric, ${contest.startsAt.toISOString()}::timestamptz, ${contest.endsAt.toISOString()}::timestamptz)`);
  });
  if (pairs.length === 0 || limit <= 0) return [];
  const rows = await db.execute(sql`
    with pairs(contest_slug, problem_slug, worth, starts_at, ends_at) as (values ${sql.join(pairs, sql`, `)}),
    eligible as (
      select s.id, s.uid, s.contest_slug, s.problem_slug, s.created_at,
        case when jsonb_typeof(s.result -> 'score') = 'number' then
          greatest(0, (s.result ->> 'score')::numeric *
            case when jsonb_typeof(s.result -> 'maxScore') = 'number'
              then case when (s.result ->> 'maxScore')::numeric > 0
                then p.worth / (s.result ->> 'maxScore')::numeric else 1 end
              else 1 end) else 0 end as score,
        s.result -> ${ACCEPTED_FIELD} = ${JSON.stringify(ACCEPTED_VALUE)}::jsonb as accepted
      from submissions s join accounts a on a.uid = s.uid
      join pairs p on p.contest_slug = s.contest_slug and p.problem_slug = s.problem_slug
      where a.status = 'active' and s.state = 'completed'
        and s.created_at <= ${now.toISOString()}::timestamptz
        and s.created_at >= p.starts_at
        and s.created_at <= p.ends_at
    ), counts as (
      select uid, count(*)::int as submissions from eligible group by uid
    ), solved_problems as (
      select uid, contest_slug, problem_slug
      from eligible where accepted group by uid, contest_slug, problem_slug
    ), best as (
      select distinct on (uid, contest_slug, problem_slug) uid, score, created_at
      from eligible
      order by uid, contest_slug, problem_slug, score desc, created_at, id
    ), scores as (
      select uid, sum(score) as total, max(created_at) filter (where score > 0) as reached_at
      from best group by uid
    ), solved_counts as (
      select uid, count(*)::int as solved from solved_problems group by uid
    ), first_solves as (
      select distinct on (contest_slug, problem_slug) uid from eligible where accepted
      order by contest_slug, problem_slug, created_at, id
    ), first_bloods as (
      select uid, count(*)::int as total from first_solves group by uid
    )
    select (rank() over (order by sc.total desc, sc.reached_at asc nulls first))::int as rank,
      sc.total::float8 as total, a.uid, a.username, a.nickname, c.submissions,
      coalesce(solved.solved, 0)::int as solved,
      coalesce(f.total, 0)::int as "firstBloods"
    from counts c join accounts a on a.uid = c.uid
    left join scores sc on sc.uid = c.uid
    left join solved_counts solved on solved.uid = c.uid
    left join first_bloods f on f.uid = c.uid
    order by sc.total desc, sc.reached_at asc nulls first, a.uid asc
    limit ${limit}
  `);
  return rows.rows as unknown as LeaderboardRow[];
}
