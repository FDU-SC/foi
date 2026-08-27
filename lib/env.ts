import { z } from "zod";
import { TIERS } from "@/lib/boot/deployment";

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

  FOI_BACKEND_SECRET: z
    .string("未设置。用 openssl rand -hex 32 生成，并与题目后端保持一致")
    .min(16, "太短。用 openssl rand -hex 32 生成，并与题目后端保持一致"),

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

  FOI_RELEASE_SHA: z
    .string()
    .optional()
    .refine(
      (value) =>
        value === undefined || value === "" || /^[0-9a-f]{7,40}$/.test(value),
      "必须是 git commit 的十六进制 sha",
    ),

  FOI_MAIL_DELIVERY: z
    .enum(["smtp", "console"], {
      message: '必须是 "smtp" 或 "console"',
    })
    .optional(),

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

export function assertEnv(
  env: Record<string, string | undefined> = process.env,
): void {
  const parsed = schema.safeParse(env);

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
