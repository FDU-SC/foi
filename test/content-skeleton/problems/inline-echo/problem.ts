import type { ProblemUi } from "../../components/ui-config";
import type { InlineJudge, ProblemConfigInput } from "@/lib/problems/types";

interface EchoConfig {
  expected: string;
}

/**
 * Judged in the kernel's own process, synchronously, inside the submit request.
 *
 * Small enough to be obviously safe — a string comparison against a config
 * value — which is the whole test for whether a judgement belongs inline. It
 * also shows the other thing an inline judge may answer: `unavailable`, when
 * the problem is misconfigured, so that the row lands `disrupted` instead of
 * charging the submitter a zero.
 */
const judge: InlineJudge = ({ payload, config }) => {
  const expected = (config as EchoConfig | undefined)?.expected;
  if (!expected) {
    return { unavailable: true, reason: "题目配置缺少 expected" };
  }

  const answer =
    typeof payload === "object" && payload !== null
      ? (payload as { text?: unknown }).text
      : undefined;

  return typeof answer === "string" && answer.trim() === expected
    ? { status: "accepted", score: 100, maxScore: 100, accepted: true }
    : { status: "wrong_answer", score: 0, maxScore: 100, accepted: false };
};

export const problem = {
  slug: "inline-echo",
  title: "回声",
  maxScore: 100,
  backend: {
    kind: "inline",
    judge,
    config: { expected: "echo" } satisfies EchoConfig,
  },
  ui: { submit: "text", placeholder: "把提示里的词原样填回来" } satisfies ProblemUi,
  tags: ["示例"],
  order: 1,
} satisfies ProblemConfigInput;
