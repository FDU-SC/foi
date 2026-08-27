\set ON_ERROR_STOP on

\set contest_slug 'demo-acm'
\set contest_title '演示赛 · ACM 赛制'

CREATE TEMP TABLE demo_plan (username text, slug text, minute int, ok boolean);

INSERT INTO demo_plan VALUES
  ('alice', 'maze-runner', 20, true),
  ('alice', 'maze-runner', 12, false),
  ('bob',   'maze-runner', 15, true),
  ('carol', 'maze-runner', 18, false),
  ('carol', 'maze-runner', 33, false),
  ('carol', 'maze-runner', 50, true),
  ('admin', 'maze-runner', 10, false);

DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(DISTINCT p.username, '、') INTO missing
  FROM demo_plan p
  LEFT JOIN accounts a ON lower(a.username) = lower(p.username)
  WHERE a.uid IS NULL;

  IF missing IS NOT NULL THEN
    RAISE EXCEPTION
      '演示提交需要账号 %，库里还没有。先跑 pnpm db:seed，再执行本脚本', missing;
  END IF;
END $$;

INSERT INTO problems (slug, title)
SELECT DISTINCT slug, slug FROM demo_plan
ON CONFLICT (slug) DO NOTHING;

INSERT INTO contests (slug, title)
VALUES (:'contest_slug', :'contest_title')
ON CONFLICT (slug) DO NOTHING;

WITH

window_start(at) AS (
  VALUES (timestamptz '2026-08-01T13:00:00+08:00')
),

scoring(max_score) AS (
  VALUES (double precision '100')
),

resolved_uids AS (
  SELECT p.username, p.slug, p.minute, p.ok, a.uid
  FROM demo_plan p
  INNER JOIN accounts a ON lower(a.username) = lower(p.username)
)
INSERT INTO submissions (
  id, uid, problem_slug, contest_slug, payload, state,
  verdict, score, max_score, backend_id,
  created_at, judged_at
)
SELECT
  'sub_demo_' || plan.uid || '_' || plan.slug || '_' || plan.minute,
  plan.uid,
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
FROM resolved_uids plan
CROSS JOIN window_start w
CROSS JOIN scoring s
ON CONFLICT (id) DO NOTHING;

DO $$
DECLARE
  planned int;
  present int;
BEGIN
  SELECT count(*) INTO planned FROM demo_plan;
  SELECT count(*) INTO present
  FROM submissions
  WHERE id IN (
    SELECT 'sub_demo_' || a.uid || '_' || p.slug || '_' || p.minute
    FROM demo_plan p
    INNER JOIN accounts a ON lower(a.username) = lower(p.username)
  );

  IF present <> planned THEN
    RAISE EXCEPTION '本该有 % 条演示提交，实际只有 %', planned, present;
  END IF;

  RAISE NOTICE '演示赛种子提交 % 条已就位', present;
END $$;

DROP TABLE demo_plan;
