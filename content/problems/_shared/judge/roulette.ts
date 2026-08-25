import "server-only";
import { createHmac } from "node:crypto";
import type { InlineJudge } from "@/lib/problems/types";

/**
 * Inline judging for the daily check-in wheel.
 *
 * A per-player answer is still an inline judgement when it can be *derived*
 * rather than stored. The spin comes out of `HMAC(secret, handle | date)`:
 * unpredictable to the player because they do not hold the key, reproducible
 * to the server because it is a pure function of two things it already knows,
 * and stateless — there is no table of issued numbers to keep, expire, or lose.
 * That is the test for this side of the line, and it is the same technique that
 * would give a CTF problem a different flag per competitor without a service
 * to mint them.
 *
 * Two things changed when this moved off the mock backend, and both were bugs:
 *
 * The wheel is now **per player**. It used to be one wheel a day for everyone,
 * which the statement advertised as a feature — but the verdict reveals the
 * number, so the first person to submit could hand today's answer to everyone
 * else. A private wheel makes that impossible rather than discouraged.
 *
 * The spin is now **keyed**. It used to be `sha256("roulette:" + date)`, which
 * the statement claimed nobody could know in advance, including the setter.
 * Anyone who could guess that one line could compute a month of results. The
 * key is what makes the claim true.
 */
export interface RouletteConfig {
  /** Awarded for naming the exact number. Also the problem's full marks. */
  scoreNumber: number;
  /** Awarded for naming the colour. */
  scoreColor: number;
  /** Awarded for naming big or small. */
  scoreSize: number;
}

/** `YYYY-MM-DD` in the server's zone, which is the day a check-in belongs to. */
function today(now: Date): string {
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

export const judgeRoulette: InlineJudge = ({ payload, config, user }) => {
  const cfg = (config ?? {}) as Partial<RouletteConfig>;
  const scoreNumber = cfg.scoreNumber ?? 100;
  const scoreColor = cfg.scoreColor ?? 30;
  const scoreSize = cfg.scoreSize ?? 10;

  // `assertEnv` holds this at boot, so reaching the guard means something is
  // very wrong — but a missing key would otherwise silently make every spin
  // derivable, which is the failure this whole function exists to avoid.
  // Declining outright rather than returning a zero: a deployment missing its
  // signing key is not something to charge the person who happened to check in
  // that morning.
  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return { unavailable: true, reason: "缺少 AUTH_SECRET，无法生成今日轮盘" };
  }

  // Domain-separated rather than hashing the bare inputs: `AUTH_SECRET` signs
  // other things, and a prefix costs nothing while keeping this use from ever
  // colliding with one of them.
  const digest = createHmac("sha256", secret)
    .update(`roulette|${user.handle}|${today(new Date())}`)
    .digest();

  const number = digest.readUInt32BE(0) % 37;
  const color = number === 0 ? "green" : number % 2 === 1 ? "red" : "black";
  const size = number === 0 ? null : number <= 18 ? "small" : "big";

  const submitted = String((payload as { text?: unknown })?.text ?? "")
    .trim()
    .toLowerCase();

  let score = 0;
  let hit: string;
  if (submitted === String(number)) {
    score = scoreNumber;
    hit = `押中数字 ${number}`;
  } else if (submitted === color) {
    score = scoreColor;
    hit = `押中颜色 ${color}`;
  } else if (size !== null && submitted === size) {
    score = scoreSize;
    hit = `押中大小 ${size}`;
  } else {
    hit = `未命中（${submitted || "空"}）`;
  }

  return {
    status:
      score >= scoreNumber ? "accepted" : score > 0 ? "partial" : "wrong_answer",
    score,
    maxScore: scoreNumber,
    detail: {
      number,
      color,
      size,
      hit,
      message: `你的今日结果：数字 ${number}（${color}${size ? `，${size}` : ""}）。你押「${submitted}」→ ${hit}${score > 0 ? `，+${score} 分` : "，0 分"}。明天再来！`,
    },
  };
};
