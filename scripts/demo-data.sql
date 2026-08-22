-- Fills the demo contest with submissions from several users so the standings
-- have something to rank. Judging itself is verified end-to-end elsewhere;
-- these rows stand in for already-judged results.

\set contest_slug 'demo-acm'

WITH c AS (
  SELECT id, starts_at FROM contests WHERE slug = :'contest_slug'
),
b AS (
  INSERT INTO contest_problems (contest_id, problem_slug, label, "order")
  SELECT c.id, 'leaky-bucket', 'B', 1 FROM c
  ON CONFLICT (contest_id, problem_slug) DO UPDATE SET label = 'B'
  RETURNING contest_id
)
SELECT 1 FROM b;

-- (user handle, problem, minutes after start, accepted)
WITH c AS (
  SELECT id, starts_at FROM contests WHERE slug = :'contest_slug'
),
plan(handle, slug, minute, ok) AS (
  VALUES
    ('alice', 'maze-runner',  20, true),
    ('alice', 'leaky-bucket', 30, false),
    ('alice', 'leaky-bucket', 45, true),
    ('bob',   'maze-runner',  15, true),
    ('bob',   'leaky-bucket', 22, false),
    ('bob',   'leaky-bucket', 40, false),
    ('carol', 'maze-runner',  18, false),
    ('carol', 'maze-runner',  33, false),
    ('carol', 'maze-runner',  50, true),
    ('carol', 'leaky-bucket', 60, true),
    ('admin', 'maze-runner',  10, false)
)
INSERT INTO submissions (
  id, user_id, problem_slug, contest_id, payload, state,
  verdict, score, max_score, judge_id, callback_token_hash,
  created_at, judged_at
)
SELECT
  'sub_demo_' || u.handle || '_' || plan.slug || '_' || plan.minute,
  u.id,
  plan.slug,
  c.id,
  '{"seeded": true}'::jsonb,
  'completed',
  jsonb_build_object(
    'status', CASE WHEN plan.ok THEN 'accepted' ELSE 'wrong_answer' END,
    'score', CASE WHEN plan.ok THEN p.max_score ELSE 0 END,
    'maxScore', p.max_score
  ),
  CASE WHEN plan.ok THEN p.max_score ELSE 0 END,
  p.max_score,
  'traditional',
  'seeded',
  c.starts_at + (plan.minute || ' minutes')::interval,
  c.starts_at + (plan.minute || ' minutes')::interval
FROM plan
JOIN users u ON u.handle = plan.handle
JOIN problems p ON p.slug = plan.slug
CROSS JOIN c
ON CONFLICT (id) DO NOTHING;
