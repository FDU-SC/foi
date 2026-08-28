/**
 * 部署档位。
 *
 * 回答的是「这套部署里有没有真东西」，不是它在发布流程里排第几。装着真实账号与
 * 未公开赛题的预发布环境，和生产一样经不起一次配置疏忽，它填 `prod`。发布流程分
 * 几级是运维的事，平台不需要知道。
 */
export const TIERS = ["dev", "prod"] as const;

export type Tier = (typeof TIERS)[number];

function isTier(value: string | undefined): value is Tier {
  return TIERS.includes(value as Tier);
}

export function tier(): Tier {
  const declared = process.env.FOI_ENV;
  if (isTier(declared)) return declared;

  return process.env.NODE_ENV === "production" ? "prod" : "dev";
}

export function releaseSha(): string | null {
  return process.env.FOI_RELEASE_SHA || null;
}
