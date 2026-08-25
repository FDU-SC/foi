import "server-only";
import type { InlineJudge } from "@/lib/problems/types";

/**
 * Inline judging for problems where the answer is a fixed string.
 *
 * On this side of the line because everything the judgement needs is already
 * in the kernel's hands: the submitted text and the expected text, both
 * already in this process. There is nothing to isolate — no submitted code
 * runs — and nothing to measure. Sending a string comparison out to a service
 * would buy a URL, a secret, a queue, a `/status` endpoint and a deployment,
 * in exchange for nothing.
 *
 * The expected answers stay in `backend.config`, exactly as they did when a
 * backend read them: `toPublicConfig` strips the whole `backend` key before
 * anything reaches a browser, and `scripts/check-client-bundle.cjs` fails the
 * build if one of these strings turns up in a client chunk anyway.
 */
interface OutputCase {
  name?: string;
  /** The exact text the submitter's corresponding line must equal. */
  expected: string;
}

export interface OutputOnlyConfig {
  cases: OutputCase[];
}

/**
 * The submission is one text holding every scene's answer, one per line,
 * compared against `config.cases` in order. Both sides are trimmed, so
 * trailing whitespace is not an answer.
 */
export const judgeOutputOnly: InlineJudge = ({ payload, config }) => {
  const cases = ((config as OutputOnlyConfig | undefined)?.cases ?? []).filter(
    (testCase) => testCase.expected !== undefined,
  );

  if (cases.length === 0) {
    // A problem that reached production with no cases is a setter's mistake,
    // not a competitor's. `system_error` is what says so — it renders as a
    // fault rather than as a wrong answer, and it does not cost a score.
    return {
      status: "system_error",
      score: 0,
      maxScore: 100,
      detail: { message: "题目配置缺少 cases" },
    };
  }

  const submitted = String((payload as { text?: unknown })?.text ?? "").trim();
  const lines = submitted.split(/\r?\n/).map((line) => line.trim());

  const perCase = 100 / cases.length;
  let score = 0;
  const tests = cases.map((testCase, index) => {
    const pass = lines[index] === testCase.expected.trim();
    if (pass) score += perCase;
    return {
      name: testCase.name ?? `场景 ${index + 1}`,
      status: pass ? "accepted" : "wrong_answer",
      score: pass ? perCase : 0,
      maxScore: perCase,
    };
  });

  return {
    status: score >= 100 ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore: 100,
    detail: { tests },
  };
};
