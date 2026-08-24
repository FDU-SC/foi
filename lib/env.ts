import { z } from "zod";
import { backendsMissingUrl } from "@/backends.config";

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
 * neither should stop a boot. Backend addresses used to be excused on the same
 * grounds and are not any more — see `backendUrlProblems` below for why that
 * was the wrong list to be on.
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
 * Backend addresses, which are fatal in production and nowhere else.
 *
 * Outside the schema because the variables are named after whatever
 * `backends.config.ts` declares rather than fixed here, and conditional
 * because the answer depends on where this is running. Outside production a
 * missing address falls back to the mock in `scripts/mock-backend.ts`, which
 * is what lets a fresh checkout submit before anything has been configured. In
 * production there is no such fallback and no such excuse: a backend nothing
 * can reach fails exactly the way a wrong `FOI_PUBLIC_URL` does, silently and
 * one submission at a time, which is why that variable is on the list above
 * and why these belong beside it.
 *
 * Every declared entry, not only the ones a problem routes to. Telling those
 * apart means reading the problem registry, and this file deliberately knows
 * nothing about content — the same split `backendSecretWarnings` sits on the
 * other side of. What the wider rule costs is an address for a backend nothing
 * currently uses, so the message offers the other way out: delete the entry.
 */
function backendUrlProblems(
  env: Record<string, string | undefined>,
): string[] {
  if (env.NODE_ENV !== "production") return [];

  return backendsMissingUrl(env).map(
    (variable) =>
      `${variable}: 未设置。生产环境不再回落到本地 mock，` +
      `这台题目后端收不到任何投递，交上来的题会一直等到十分钟后被判为超时。` +
      `填上它的地址；这套部署不运行它，就从 backends.config.ts 里删掉该条目`,
  );
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
  const problems = [
    ...(parsed.success
      ? []
      : parsed.error.issues.map((issue) => {
          const name = issue.path.join(".");
          return name ? `${name}: ${issue.message}` : issue.message;
        })),
    ...backendUrlProblems(env),
  ];

  if (problems.length === 0) return;

  throw new Error(
    `环境变量配置不完整，拒绝启动:\n` +
      problems.map((problem) => `  - ${problem}`).join("\n"),
  );
}
