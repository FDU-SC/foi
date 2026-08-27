import "server-only";
import { createHmac } from "node:crypto";
import type { InlineJudge } from "@/lib/problems/types";

export interface RouletteConfig {

  scoreNumber: number;

  scoreColor: number;

  scoreSize: number;
}

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

  const secret = process.env.AUTH_SECRET;
  if (!secret) {
    return { unavailable: true, reason: "缺少 AUTH_SECRET，无法生成今日轮盘" };
  }

  const digest = createHmac("sha256", secret)
    .update(`roulette|${user.uid}|${today(new Date())}`)
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
    result: {
      status:
        score >= scoreNumber ? "accepted" : score > 0 ? "partial" : "wrong_answer",
      score,
      maxScore: scoreNumber,
    },
    detail: {
      number,
      color,
      size,
      hit,
      message: `你的今日结果：数字 ${number}（${color}${size ? `，${size}` : ""}）。你押「${submitted}」→ ${hit}${score > 0 ? `，+${score} 分` : "，0 分"}。明天再来！`,
    },
  };
};
