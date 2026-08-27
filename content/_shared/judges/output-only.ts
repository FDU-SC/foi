import "server-only";
import type { InlineJudge } from "@/lib/problems/types";

interface OutputCase {
  name?: string;

  expected: string;
}

export interface OutputOnlyConfig {
  cases: OutputCase[];
}

export const judgeOutputOnly: InlineJudge = ({ payload, config }) => {
  const cases = ((config as OutputOnlyConfig | undefined)?.cases ?? []).filter(
    (testCase) => testCase.expected !== undefined,
  );

  if (cases.length === 0) {

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

  const passed = tests.filter((test) => test.status === "accepted").length;
  const allPassed = passed === cases.length;

  return {
    status: allPassed ? "accepted" : passed > 0 ? "partial" : "wrong_answer",

    accepted: allPassed,
    score: allPassed ? 100 : passed * perCase,
    maxScore: 100,
    detail: { tests },
  };
};
