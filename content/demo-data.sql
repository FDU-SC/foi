-- Fills the demo contest with submissions from several handles so the
-- standings have something to rank. Judging itself is verified end-to-end
-- elsewhere; these rows stand in for already-judged results.
--
--   psql "$DATABASE_URL" -f content/demo-data.sql
--
-- The contest and the problem are declared in content/, not in the database.
-- Their rows in `problems` and `contests` are foreign key anchors written by
-- ensureProblem/ensureContest at the moment a submission first needs them, and
-- by nothing else — the startup sync that used to write them is gone. A script
-- that inserts into `submissions` directly is standing in for that path, so it
-- writes the same two rows the path would have, which is what the first two
-- statements below do.
--
-- They are the fix for a failure worth naming: this file used to reach the
-- anchors with `JOIN problems`, so on a database nobody had submitted on the
-- join matched nothing, zero rows went in, and psql said it had succeeded.
-- Both of those joins are gone, and everything this file does not own —
-- the accounts, which are `pnpm db:seed`'s — is now asserted rather than
-- silently filtered on. It can no longer report success having done nothing.

\set ON_ERROR_STOP on

\set contest_slug 'demo-acm'
\set contest_title '演示赛 · ACM 赛制'

-- (handle, problem, minutes after contest start, accepted)
--
-- A temporary table rather than a CTE because three statements read it: the
-- problem anchors, the submissions, and the count at the bottom that checks
-- every planned row actually landed. One list, so none of the three can fall
-- behind the others. Dropped again at the bottom, and `ON_ERROR_STOP` ends the
-- session on the way out of any path that does not reach it.
CREATE TEMP TABLE demo_plan (handle text, slug text, minute int, ok boolean);

INSERT INTO demo_plan VALUES
  ('alice', 'maze-runner', 20, true),
  ('alice', 'maze-runner', 12, false),
  ('bob',   'maze-runner', 15, true),
  ('carol', 'maze-runner', 18, false),
  ('carol', 'maze-runner', 33, false),
  ('carol', 'maze-runner', 50, true),
  ('admin', 'maze-runner', 10, false);

-- The accounts are not this file's to create, and a missing one would
-- otherwise surface as a foreign key violation naming a constraint. Checked
-- first so the answer is the command to run instead.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(DISTINCT p.handle, '、') INTO missing
  FROM demo_plan p
  LEFT JOIN accounts a ON a.handle = p.handle
  WHERE a.handle IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      '演示提交需要账号 %，库里还没有。先跑 pnpm db:seed，再执行本脚本', missing;
  END IF;
END $$;

-- Derived from the plan rather than spelled out, so adding a problem to it
-- cannot leave an anchor behind. The slug stands in for the title: the
-- registry owns that string and every page reads it from there while the
-- problem still exists in content/, and ensureProblem overwrites this one from
-- content/ the first time somebody really submits.
INSERT INTO problems (slug, title)
SELECT DISTINCT slug, slug FROM demo_plan
ON CONFLICT (slug) DO NOTHING;

-- Only ever one, so it is written out, title and all.
INSERT INTO contests (slug, title)
VALUES (:'contest_slug', :'contest_title')
ON CONFLICT (slug) DO NOTHING;

WITH
-- Mirrors the window declared in the contest file. Kept here rather than read
-- from the database because the mirror table holds no schedule any more.
window_start(at) AS (
  VALUES (timestamptz '2026-08-01T13:00:00+08:00')
),
-- And the same for the total, mirroring content/problems/maze-runner. Not read
-- from `problems`: that table is a foreign key anchor holding a slug and a
-- title, and a submission's denominator is written onto the row when it is
-- judged rather than looked up.
scoring(max_score) AS (
  VALUES (double precision '100')
)
INSERT INTO submissions (
  id, handle, problem_slug, contest_slug, payload, state,
  verdict, score, max_score, backend_id,
  created_at, judged_at
)
SELECT
  'sub_demo_' || plan.handle || '_' || plan.slug || '_' || plan.minute,
  plan.handle,
  plan.slug,
  :'contest_slug',
  '{"seeded": true}'::jsonb,
  'completed',
  jsonb_build_object(
    'status', CASE WHEN plan.ok THEN 'accepted' ELSE 'wrong_answer' END,
    'score', CASE WHEN plan.ok THEN s.max_score ELSE 0 END,
    'maxScore', s.max_score
  ),
  CASE WHEN plan.ok THEN s.max_score ELSE 0 END,
  s.max_score,
  'traditional',
  w.at + (plan.minute || ' minutes')::interval,
  w.at + (plan.minute || ' minutes')::interval
FROM demo_plan plan
CROSS JOIN window_start w
CROSS JOIN scoring s
ON CONFLICT (id) DO NOTHING;

-- The backstop. `ON CONFLICT DO NOTHING` above makes a second run a no-op, so
-- this counts what is on the table rather than what this run wrote — the
-- question is whether the demo data is there, not whether this invocation is
-- the one that put it there.
DO $$
DECLARE
  planned int;
  present int;
BEGIN
  SELECT count(*) INTO planned FROM demo_plan;
  SELECT count(*) INTO present
  FROM submissions
  WHERE id IN (
    SELECT 'sub_demo_' || handle || '_' || slug || '_' || minute FROM demo_plan
  );

  IF present <> planned THEN
    RAISE EXCEPTION '本该有 % 条演示提交，实际只有 %', planned, present;
  END IF;

  RAISE NOTICE '演示赛种子提交 % 条已就位', present;
END $$;

DROP TABLE demo_plan;
