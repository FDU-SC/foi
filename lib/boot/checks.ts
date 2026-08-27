import { assertEnv } from "@/lib/env";
import { releaseSha, tier, type Tier } from "./deployment";

/**
 * Everything checked before this process is allowed to serve, and the one
 * place that decides which of those findings is fatal.
 *
 * Previously four asserts called in a row from `instrumentation.ts`, each
 * spelling its own `if (process.env.NODE_ENV !== "production") return`. That
 * had two costs. The severity rule was written four times, so teaching the
 * deployment about a third tier meant editing four modules — and none of them
 * could learn it, because `NODE_ENV` is `production` on staging too. And the
 * first assert to throw hid the rest, so a fresh deployment missing three
 * things learned about them one deploy at a time, which is the exact failure
 * `assertEnv` aggregates its own findings to avoid.
 *
 * So: the domain modules answer *what is wrong*, in their own words, and this
 * file answers *whether that stops the boot here*.
 */

export interface Check {
  /** Fully worded findings, or empty when there is nothing to say. */
  complaints: () => string[];
  /** Tiers where a finding refuses the boot. Empty means never. */
  fatalIn: readonly Tier[];
}

const ONLY_PROD = ["prod"] as const;
const NEVER = [] as const;

/**
 * Loaded after `assertEnv` has passed, and that ordering is the reason these
 * are dynamic.
 *
 * Every module below reaches the content registries, whose evaluation walks
 * `content/` and can fail on its own account. Importing them at the top of this
 * file would put that evaluation before the environment check, so a deployment
 * that is missing `DATABASE_URL` *and* carries a malformed problem would be
 * told about the problem — true, but not the thing standing between it and a
 * working boot.
 */
async function loadChecks(): Promise<Check[]> {
  const [backend, mail, mailTemplates, enrollment, contests, problems] =
    await Promise.all([
      import("@/lib/backend/boot"),
      import("@/lib/mail/transport"),
      import("@/lib/mail/registry"),
      import("@/lib/enrollment/registry"),
      import("@/lib/contests/registry"),
      import("@/lib/problems/access"),
    ]);

  return [
    // A deployment that ships enrolment rules and forgets its relay has dead
    // ends where registration and recovery should be.
    { complaints: mail.mailDeliveryComplaints, fatalIn: ONLY_PROD },

    // The same gap with nothing declared behind it. Never fatal: the `smtp`
    // came from the kernel's own default rather than from anybody's decision,
    // and refusing would stop an empty `content/` from booting at all.
    { complaints: mail.defaultedMailDeliveryComplaints, fatalIn: NEVER },

    // Two backends on one key means compromising the softer of them yields the
    // other's whole queue.
    { complaints: backend.backendSecretComplaints, fatalIn: ONLY_PROD },

    // A player pressing 「启动实例」 against a backend with no address gets a
    // 500 they cannot act on, and nothing says so until they do.
    { complaints: backend.backendActionUrlComplaints, fatalIn: ONLY_PROD },

    // Below here: legal configurations that are probably not what somebody
    // meant. Said everywhere, refused nowhere — the CLI can still recover a
    // deployment nobody can administer, and an outage would be the worse
    // failure.
    { complaints: enrollment.enrollmentWarnings, fatalIn: NEVER },
    { complaints: contests.contestWarnings, fatalIn: NEVER },
    { complaints: problems.problemGateWarnings, fatalIn: NEVER },
    { complaints: backend.backendRegistryWarnings, fatalIn: NEVER },
    { complaints: mailTemplates.mailTemplateWarnings, fatalIn: NEVER },
  ];
}

/**
 * Checks everything, says everything, and refuses once.
 *
 * Warnings are printed before the refusal rather than after, so that a boot
 * that is about to fail still leaves the softer findings in the log — an
 * operator reading a failed deploy wants the whole picture, not the first
 * sentence of it.
 */
export async function assertBootConfiguration(): Promise<void> {
  assertEnv();

  const current = tier();
  const sha = releaseSha();
  console.log(
    `[foi] 环境 ${current}，构建自 ${sha ?? "未知 commit（非 CI 构建）"}`,
  );

  // Every check runs before any of them is allowed to stop the boot.
  const refusals: string[] = [];
  const warnings: string[] = [];

  for (const check of await loadChecks()) {
    const into = check.fatalIn.includes(current) ? refusals : warnings;
    into.push(...check.complaints());
  }

  for (const warning of warnings) console.warn(`[foi] ${warning}`);

  if (refusals.length === 0) return;

  throw new Error(
    `配置不完整，拒绝启动（环境 ${current}）:\n` +
      refusals.map((refusal) => `  - ${refusal}`).join("\n"),
  );
}
