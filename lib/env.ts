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
 * Only the variables whose absence is fatal are listed. Backend URLs have
 * defaults, SMTP has a documented fallback that logs to the console, and the
 * backup interval has a default — none of those should stop a boot.
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

  // Backends call back to this, so a wrong value is not a local problem: every
  // verdict silently fails to arrive and the reconciler gives up ten minutes
  // later, one submission at a time.
  FOI_PUBLIC_URL: z
    .string("未设置，题目后端将无法回调")
    .refine((value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }, "必须是完整的 URL，例如 https://foi.example.com"),

  FOI_BACKEND_SECRET: z
    .string("未设置。用 openssl rand -hex 32 生成，并与题目后端保持一致")
    .min(16, "太短。用 openssl rand -hex 32 生成，并与题目后端保持一致"),
});

/**
 * Accepts the pre-rename spelling of the shared secret.
 *
 * Normalised here rather than in the schema so that everything downstream sees
 * one name, and so the fallback is a single line to delete once the deployed
 * environments have been updated. `resolveBackend` reads the same pair.
 */
function withLegacyNames(
  env: Record<string, string | undefined>,
): Record<string, string | undefined> {
  return {
    ...env,
    FOI_BACKEND_SECRET: env.FOI_BACKEND_SECRET ?? env.FOI_JUDGE_SECRET,
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
  if (parsed.success) return;

  // Prefixed with the variable name. Without it a missing value reports Zod's
  // own "expected string, received undefined", which tells an operator staring
  // at a failed deploy neither which variable nor what to put in it.
  const problems = parsed.error.issues
    .map((issue) => {
      const name = issue.path.join(".");
      return name ? `  - ${name}: ${issue.message}` : `  - ${issue.message}`;
    })
    .join("\n");

  throw new Error(`环境变量配置不完整，拒绝启动:\n${problems}`);
}
