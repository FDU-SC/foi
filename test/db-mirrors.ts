import { Client } from "pg";

/**
 * Leave the database with the mirror rows the suite found, plus nothing.
 *
 * `submissions.problem_slug` and `contest_slug` are foreign keys, so a test that
 * writes a submission has to put a row in `problems` and `contests` first —
 * sometimes directly, often through the `ensureProblem`/`ensureContest` that
 * `createSubmission` calls. Those rows outlive the run, and because the `db`
 * project runs against whatever `DATABASE_URL` names, a suite pointed at a real
 * deployment leaves it reporting history for problems and contests the
 * repository never shipped.
 *
 * The set is taken before the suite and only additions are removed, so a row
 * that was already there — a deployment's own mirror, or one a submission still
 * points at — is never touched. That makes this exact rather than a guess at
 * which slugs a test might have used, and it covers a test written later without
 * asking its author to remember anything.
 *
 * Only rows without a status are considered: a mirror is what a test creates as
 * a side effect. An authored problem is something a test creates on purpose, and
 * removing one would be destroying the thing under test.
 *
 * This is a `globalSetup` rather than a hook in each file because the leak has
 * several sources — direct inserts, the production helpers, and whatever a
 * future test does — and one guarantee at the boundary is easier to keep than
 * one line in each of a dozen files.
 */

interface Mirrors {
  problems: Set<string>;
  contests: Set<string>;
}

async function connect(): Promise<Client> {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();
  return client;
}

async function readMirrors(client: Client): Promise<Mirrors> {
  const [problems, contests] = await Promise.all([
    client.query<{ slug: string }>("select slug from problems where status is null"),
    client.query<{ slug: string }>("select slug from contests"),
  ]);

  return {
    problems: new Set(problems.rows.map((row) => row.slug)),
    contests: new Set(contests.rows.map((row) => row.slug)),
  };
}

/** Only when nothing points at it: the foreign key refuses the delete otherwise. */
async function remove(client: Client, kind: keyof Mirrors, slug: string): Promise<number> {
  const result =
    kind === "problems"
      ? await client.query(
          `delete from problems p
            where p.slug = $1
              and p.status is null
              and not exists (select 1 from submissions s where s.problem_slug = p.slug)`,
          [slug],
        )
      : await client.query(
          `delete from contests c
            where c.slug = $1
              and not exists (select 1 from submissions s where s.contest_slug = c.slug)`,
          [slug],
        );

  return result.rowCount ?? 0;
}

export default async function setup(): Promise<(() => Promise<void>) | undefined> {
  if (!process.env.DATABASE_URL) return undefined;

  const opening = await connect();
  let before: Mirrors;
  try {
    before = await readMirrors(opening);
  } finally {
    await opening.end();
  }

  return async () => {
    const closing = await connect();
    try {
      const after = await readMirrors(closing);
      let removed = 0;

      for (const kind of ["problems", "contests"] as const) {
        for (const slug of after[kind]) {
          if (before[kind].has(slug)) continue;
          removed += await remove(closing, kind, slug);
        }
      }

      if (removed > 0) {
        console.log(`[db] 已清理测试留下的 ${removed} 行题目或比赛镜像`);
      }
    } catch (error) {
      // A teardown that fails must not turn a green suite red; the rows it could
      // not remove are the ones it was asked to be careful about anyway.
      console.warn("[db] 清理测试留下的镜像行失败", error);
    } finally {
      await closing.end();
    }
  };
}
