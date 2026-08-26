-- Fills the demo contest with submissions from several handles so the
-- standings have something to rank. Judging itself is verified end-to-end
-- elsewhere; these rows stand in for already-judged results.
--
-- The contest and its problem set are not inserted here: they live in
-- content/contests/demo-acm/contest.ts, and the mirror rows they need are
-- written by ensureProblem/ensureContest on the submission path. Nothing else
-- writes them — the startup sync that used to is gone — so submit to
-- maze-runner once before running this, or the JOIN below matches nothing and
-- inserts nothing, silently.

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
FROM plan
JOIN credentials c ON c.handle = plan.handle
-- Only for the foreign key: the row has to be there before a submission may
-- reference it. See the header.
JOIN problems p ON p.slug = plan.slug
CROSS JOIN window_start w
CROSS JOIN scoring s
ON CONFLICT (id) DO NOTHING;
