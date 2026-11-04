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

const GUARDED = ["AUTH_SECRET", "FOI_BACKEND_SECRET"];

export function placeholderSecrets(
  env: Record<string, string | undefined> = process.env,
): string[] {
  return GUARDED
    .filter((name) => {
      const value = env[name]?.trim().toLowerCase();
      return value !== undefined && value !== "" && PLACEHOLDERS.has(value);
    })
    .sort()
    .map(
      (name) =>
        `${name} 使用的是默认值，用 openssl rand -hex 32 换掉`,
    );
}
