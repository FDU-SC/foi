/**
 * Values that ship in `.env.example` and in getting-started documentation.
 * They are long enough to clear the 16 character floor in `lib/env.ts`, so a
 * deployment that never replaced them passes every other check while the key
 * itself sits in source control for anyone to read.
 */
const PLACEHOLDERS = new Set([
  "dev-only-not-a-real-secret-change-in-production",
  "dev-secret",
  "please-change-me",
  "change-me",
  "changeme",
  "secret",
  "password",
]);

/** Secrets that are always present, regardless of which backends are declared. */
const ALWAYS_GUARDED = ["AUTH_SECRET", "FOI_BACKEND_SECRET"];

/** Per-backend overrides. Matched by shape so backends added later are covered. */
const PER_BACKEND = /^FOI_BACKEND_[A-Z0-9_]+_SECRET$/;

function consequenceOf(name: string): string {
  if (name === "AUTH_SECRET") {
    return "任何人都能伪造登录会话，以任意账号（包括管理员）进站";
  }
  return (
    "任何人都能领走评测队列里的提交、读到里面所有人的代码、" +
    "并写回任意评测结果"
  );
}

export function placeholderSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  const names = new Set(ALWAYS_GUARDED);
  for (const name of Object.keys(env)) {
    if (PER_BACKEND.test(name)) names.add(name);
  }

  return [...names]
    .filter((name) => {
      const value = env[name]?.trim().toLowerCase();
      return value !== undefined && value !== "" && PLACEHOLDERS.has(value);
    })
    .sort()
    .map(
      (name) =>
        `${name} 还是 .env.example 里的占位值。它够长，所以长度检查放行了，` +
        `但这个值就写在仓库里，谁都看得到——${consequenceOf(name)}。` +
        `用 openssl rand -hex 32 生成一个换掉`,
    );
}
