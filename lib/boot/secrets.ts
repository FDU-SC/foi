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
        `${name} 使用的是默认值，用 openssl rand -hex 32 换掉`,
    );
}
