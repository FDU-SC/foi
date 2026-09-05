import { z } from "zod";
import { TIERS } from "@/lib/boot/deployment";
import { refuse } from "@/lib/log";

const schema = z.object({
  DATABASE_URL: z
    .string("未设置")
    .refine(
      (value) => value.startsWith("postgres://") || value.startsWith("postgresql://"),
      "必须是 postgres:// 或 postgresql:// 连接串",
    ),

  AUTH_SECRET: z
    .string("未设置，用 openssl rand -base64 32 生成")
    .min(16, "太短，用 openssl rand -base64 32 生成"),

  FOI_PUBLIC_URL: z
    .string("未设置")
    .refine((value) => {
      try {
        new URL(value);
        return true;
      } catch {
        return false;
      }
    }, "必须是完整的 URL"),

  FOI_BACKEND_SECRET: z
    .string("未设置，用 openssl rand -hex 32 生成")
    .min(16, "太短，用 openssl rand -hex 32 生成"),

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
      "必须是非负整数",
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

  refuse("环境变量配置不完整：", problems);
}
