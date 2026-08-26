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
    // not a competitor's. Declining to judge is the only answer that lands in
    // `disrupted`; a `status: "system_error"` verdict reads as a fault but is
    // still a verdict, so the row would settle as `completed`, count on the
    // board, and cost a penalised attempt in ACM.
    return { unavailable: true, reason: "题目配置缺少 cases，无法判题" };
  }

  const submitted = String((payload as { text?: unknown })?.text ?? "").trim();
  const lines = submitted.split(/\r?\n/).map((line) => line.trim());

  const perCase = 100 / cases.length;
  const tests = cases.map((testCase, index) => {
    const pass = lines[index] === testCase.expected.trim();
    return {
      name: testCase.name ?? `场景 ${index + 1}`,
      status: pass ? "accepted" : "wrong_answer",
      score: pass ? perCase : 0,
      maxScore: perCase,
    };
  });

  // Counted, not summed. Adding `perCase` up and asking whether the total
  // reached 100 is a floating-point comparison: twelve additions of `100 / 12`
  // land on 99.99999999999999 and seventeen of `100 / 17` on 99.99999999999997,
  // so an entirely correct submission settled as `partial`. Whether every case
  // passed is an integer question, and this is that question.
  const passed = tests.filter((test) => test.status === "accepted").length;
  const allPassed = passed === cases.length;

  return {
    status: allPassed ? "accepted" : passed > 0 ? "partial" : "wrong_answer",
    // Stated rather than left null, because `isAccepted` would otherwise
    // rebuild the same `score >= maxScore` comparison from the columns and get
    // the same answer wrong — the judgement and the standings would have had to
    // be fixed twice.
    accepted: allPassed,
    score: allPassed ? 100 : passed * perCase,
    maxScore: 100,
    detail: { tests },
  };
};
