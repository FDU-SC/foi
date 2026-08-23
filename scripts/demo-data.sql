-- Fills the demo contest with submissions from several handles so the
-- standings have something to rank. Judging itself is verified end-to-end
-- elsewhere; these rows stand in for already-judged results.
--
-- The contest and its problem set are no longer inserted here: they live in
-- content/contests/demo-acm/contest.ts and reach the mirror table through the
-- startup sync. Run the app once (or press 同步 on /admin) before this script.

\set contest_slug 'demo-acm'

-- (handle, problem, minutes after contest start, accepted)
WITH plan(handle, slug, minute, ok) AS (
  VALUES
    ('alice', 'maze-runner', 20, true),
    ('alice', 'maze-runner', 12, false),
    ('bob',   'maze-runner', 15, true),
    ('carol', 'maze-runner', 18, false),
    ('carol', 'maze-runner', 33, false),
    ('carol', 'maze-runner', 50, true),
    ('admin', 'maze-runner', 10, false)
),
-- Mirrors the window declared in the contest file. Kept here rather than read
-- from the database because the mirror table holds no schedule any more.
window_start(at) AS (
  VALUES (timestamptz '2026-08-01T13:00:00+08:00')
)
INSERT INTO submissions (
  id, handle, problem_slug, contest_slug, payload, state,
  verdict, score, max_score, judge_id, callback_token_hash,
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
    'score', CASE WHEN plan.ok THEN p.max_score ELSE 0 END,
    'maxScore', p.max_score
  ),
  CASE WHEN plan.ok THEN p.max_score ELSE 0 END,
  p.max_score,
  'traditional',
  'seeded',
  w.at + (plan.minute || ' minutes')::interval,
  w.at + (plan.minute || ' minutes')::interval
FROM plan
JOIN credentials c ON c.handle = plan.handle
JOIN problems p ON p.slug = plan.slug
CROSS JOIN window_start w
ON CONFLICT (id) DO NOTHING;
