export const TIERS = ["dev", "staging", "prod"] as const;

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
