import { z } from "zod";

/**
 * What the process needs before it is allowed to serve anything.
 *
 * These used to be read where they were used, which meant a missing value
 * surfaced at the first request that happened to need it: no `AUTH_SECRET`
 * looked like a broken login, no `FOI_PUBLIC_URL` looked like a broken
 * submission, and both looked fine until somebody tried. A deploy that cannot
 * work should fail while the health check is still watching, in the same way a
 * failed migration already does.
 *
 * Only the variables whose absence is fatal are listed. SMTP has a documented
 * fallback that logs to the console and the backup interval has a default;
 * neither should stop a boot.
 *
 * Backend addresses were here for a while and have gone again, which is not a
 * relaxation. Judging is pulled, so a backend needs no address; what still does
 * is a backend some problem declares an interactive action on, and *that*
 * refuses a production boot in `assertBackendActionUrls`. It has to live over
 * there because answering it means reading the problem registry, and this file
 * is deliberately incapable of knowing anything about content.
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
  // because `resolveBackend` reaches for it, though in production every backend
  // carrying traffic is now required to have its own instead — see
  // `assertBackendSecrets`.
  FOI_BACKEND_SECRET: z
    .string("未设置。用 openssl rand -hex 32 生成，并与题目后端保持一致")
    .min(16, "太短。用 openssl rand -hex 32 生成，并与题目后端保持一致"),

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
 * environments have been updated. `resolveBackend` reads the same pair.
 *
 * `||` rather than `??`, so that an empty value reads as absent — the same
 * rule `resolveBackend` and `backends.config.ts` already apply, and the reason
 * they give for it holds here twice over. A `.env` carrying an unfilled
 * `FOI_BACKEND_SECRET=` next to a filled `FOI_JUDGE_SECRET` is a mid-rename
 * deployment, which is precisely the case this fallback exists for; `??` kept
 * the `""`, skipped the fallback, and refused the boot naming the variable the
 * operator had *not* left blank.
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
