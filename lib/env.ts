import { z } from "zod";
import { TIERS } from "@/lib/boot/deployment";

/**
 * What the process needs before it is allowed to serve anything.
 *
 * Checked here rather than where each is used, because a value read at the
 * point of use surfaces at the first request that happens to need it: no
 * `AUTH_SECRET` looks like a broken login, no `FOI_PUBLIC_URL` looks like a
 * broken submission, and both look fine until somebody tries. A deploy that
 * cannot work should fail while the health check is still watching, in the
 * same way a failed migration already does.
 *
 * Only the variables whose absence is fatal are listed. SMTP has a documented
 * fallback that logs to the console and the backup interval has a default;
 * neither should stop a boot.
 *
 * Backend addresses are deliberately not here. Judging is pulled, so a backend
 * needs no address; what does need one is a backend some problem declares an
 * interactive action on, and *that* refuses a production boot through
 * `backendActionUrlComplaints`. It has to live over there because answering it
 * means reading the problem registry, and this file is deliberately incapable
 * of knowing anything about content — which is also why `lib/boot/checks.ts`
 * loads those checks dynamically, after this one has passed.
 */
const schema = z.object({
  DATABASE_URL: z
    .string("未设置，应用无法连接数据库")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "必须是 postgres:// 或 postgresql:// 连接串",
    ),

  AUTH_SECRET: z
    .string("未设置，无法签名会话。用 openssl rand -base64 32 生成")
    .min(16, "太短，会话签名不安全。用 openssl rand -base64 32 生成"),

  // Every absolute URL this deployment publishes about itself is built from
  // it, and it is the address a runner has to be pointed at — the kernel is the
  // one being connected to now, so an unreachable one means no judging at all
  // rather than one lost callback at a time.
  FOI_PUBLIC_URL: z
    .string("未设置，评测机将无法连到平台")
    .refine((value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }, "必须是完整的 URL，例如 https://foi.example.com"),

  // The fallback key, for backends given none of their own. Still mandatory
  // because `effectiveSecret` reaches for it, though in production every
  // backend carrying traffic is now required to have its own instead — see
  // `backendSecretComplaints` in `lib/backend/boot.ts`.
  FOI_BACKEND_SECRET: z
    .string("未设置。用 openssl rand -hex 32 生成，并与题目后端保持一致")
    .min(16, "太短。用 openssl rand -hex 32 生成，并与题目后端保持一致"),

  // Optional, and checked for the same reason `FOI_TRUSTED_PROXY_HOPS` below
  // is: `tier()` falls back to `NODE_ENV` when this does not name a tier, so a
  // deployment that means `staging` and writes `stagning` gets `prod` — every
  // refusal in force, mail insisting on a relay — with nothing said about why.
  // Failing closed is the right direction and a silent failure is not.
  FOI_ENV: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        value === "" ||
        (TIERS as readonly string[]).includes(value),
      `必须是 ${TIERS.join(" / ")} 之一`,
    ),

  // Baked into the image by the Dockerfile, not set by an operator, so its
  // absence is legal — a hand-built image did not come from a commit. What is
  // checked is that a value present is a value `submissions.release_sha` can be
  // trusted to mean something in: a build arg that silently arrived as the
  // literal string `${{ github.sha }}` is worse than no value at all.
  FOI_RELEASE_SHA: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined || value === "" || /^[0-9a-f]{7,40}$/.test(value),
      "必须是 git commit 的十六进制 sha",
    ),

  // Optional, and checked anyway. A typo here does not stop the process from
  // serving — it silently changes which `x-forwarded-for` entry every rate
  // limit counts by, which is the kind of wrong that shows up as a password
  // spray nobody noticed rather than as a failed boot.
  FOI_TRUSTED_PROXY_HOPS: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined ||
        value === "" ||
        (Number.isInteger(Number(value)) && Number(value) >= 0),
      "必须是非负整数：反向代理的层数，直接暴露端口时填 0",
    ),
});

/**
 * Accepts the pre-rename spelling of the shared secret.
 *
 * Normalised here rather than in the schema so that everything downstream sees
 * one name, and so the fallback is a single line to delete once the deployed
 * environments have been updated. `sharedSecret` in `lib/backend/env.ts` reads
 * the same pair, and the two have to be deleted together: this one accepting a
 * name that one does not would boot a deployment whose every submission then
 * fails to resolve a backend.
 *
 * `||` rather than `??`, so that an empty value reads as absent — the same
 * rule `sharedSecret` and `content/backends.ts` already apply, and the reason
 * they give for it holds here twice over. A `.env` carrying an unfilled
 * `FOI_BACKEND_SECRET=` next to a filled `FOI_JUDGE_SECRET` is a mid-rename
 * deployment, which is precisely the case this fallback exists for; `??` would
 * keep the `""`, skip the fallback, and refuse the boot naming the variable
 * the operator had *not* left blank.
 */
function withLegacyNames(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    FOI_BACKEND_SECRET: env.FOI_BACKEND_SECRET || env.FOI_JUDGE_SECRET,
  };
}

/**
 * Checks the environment, throwing with every problem at once.
 *
 * All of them rather than the first: fixing one variable, redeploying, and
 * discovering the next is a slow way to learn what a fresh deployment needs.
 */
export function assertEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  const parsed = schema.safeParse(withLegacyNames(env));

  // Each prefixed with the variable name. Without it a missing value reports
  // Zod's own "expected string, received undefined", which tells an operator
  // staring at a failed deploy neither which variable nor what to put in it.
  const problems = parsed.success
    ? []
    : parsed.error.issues.map((issue) => {
        const name = issue.path.join(".");
        return name ? `${name}: ${issue.message}` : issue.message;
      });

  if (problems.length === 0) return;

  throw new Error(
    `环境变量配置不完整，拒绝启动:\n` +
      problems.map((problem) => `  - ${problem}`).join("\n"),
  );
}
