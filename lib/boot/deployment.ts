/**
 * Which deployment this process is, in the two terms anything else may ask in.
 *
 * `NODE_ENV` cannot answer either question. The Dockerfile pins it to
 * `production` and all three deployed environments run that image, so a check
 * written against it treats staging as prod — which is why
 * `lib/enrollment/registration-proof.ts` derives its cookie posture from
 * `FOI_PUBLIC_URL` instead, and why `content/seed.ts` and
 * `content/mock-runner.ts` both note that "三套部署环境都会命中". Those are
 * three separate workarounds for one missing concept.
 *
 * `FOI_ENV` is that concept, and it already exists everywhere except in the
 * application: `.env.example` marks it required, 运维脚本
 * refuses a deploy whose `.env` disagrees with `FOI_EXPECTED_ENV`, and
 * 运维脚本 refuses to overwrite a target that claims to
 * be prod. Until now nothing in `lib/` read it.
 */

export const TIERS = ["dev", "staging", "prod"] as const;

export type Tier = (typeof TIERS)[number];

function isTier(value: string | undefined): value is Tier {
  return TIERS.includes(value as Tier);
}

/**
 * The tier this process believes it is running as.
 *
 * Falls back to `NODE_ENV` rather than to a literal, so that a deployment
 * predating `FOI_ENV` keeps the behaviour it has today: the image sets
 * `NODE_ENV=production`, so an unset `FOI_ENV` still lands on `prod` and no
 * refusal is quietly lifted. Only an operator writing `staging` in as many
 * words changes anything.
 *
 * A misspelling lands on `prod` for the same reason, which is the safe
 * direction — and `assertEnv` refuses the boot over it rather than letting the
 * deployment run one tier stricter than it meant to, silently.
 */
export function tier(): Tier {
  const declared = process.env.FOI_ENV;
  if (isTier(declared)) return declared;

  return process.env.NODE_ENV === "production" ? "prod" : "dev";
}

/** The tier where a misconfiguration is refused rather than reported. */
export function isProd(): boolean {
  return tier() === "prod";
}

/**
 * The commit this image was built from, recorded on every submission it files.
 *
 * Baked in by the Dockerfile from a build arg the CI supplies, which puts it at
 * the same standing as `FOI_ENV`: a fact about the deployment, fixed at
 * startup, that nothing at request time may disagree with.
 *
 * Null outside that path. A local `next dev` or a hand-built image did not come
 * from a commit, and saying so is better than inventing a value — the column it
 * feeds is only worth anything if a value in it can be trusted to name a real
 * tree.
 */
export function releaseSha(): string | null {
  return process.env.FOI_RELEASE_SHA || null;
}
