import { assertEnv } from "@/lib/env";
import { log, refuse } from "@/lib/log";
import { releaseSha, tier, TIERS, type Tier } from "./deployment";
import { placeholderSecrets } from "./secrets";

export interface Check {

  complaints: () => string[];

  fatalIn: readonly Tier[];
}

const ALWAYS = TIERS;
const ONLY_PROD = ["prod"] as const;
const NEVER = [] as const;

async function loadChecks(): Promise<Check[]> {
  const [
    backend,
    access,
    mail,
    mailTemplates,
    enrollment,
    contests,
    policies,
    authz,
  ] = await Promise.all([
    import("@/lib/backend/boot"),
    import("@/lib/backend/access"),
    import("@/lib/mail/transport"),
    import("@/lib/mail/registry"),
    import("@/lib/enrollment/registry"),
    import("@/lib/contests/warnings"),
    import("@/lib/authz/registry"),
    import("@/lib/authz/introspect"),
  ]);

  // Forces the policy set to build, so a malformed policy refuses the boot
  // rather than the first request that happens to consult it.
  policies.assertPolicyRegistry();

  return [

    { complaints: () => placeholderSecrets(), fatalIn: ONLY_PROD },

    { complaints: enrollment.enrollmentPrivilegeViolations, fatalIn: ALWAYS },

    { complaints: mail.mailDeliveryComplaints, fatalIn: ONLY_PROD },

    { complaints: backend.backendsSharingSecret, fatalIn: ONLY_PROD },

    { complaints: backend.backendsMissingActionUrl, fatalIn: ONLY_PROD },

    { complaints: contests.catalogueComplaints, fatalIn: ALWAYS },

    { complaints: contests.orphanedProblemComplaints, fatalIn: ONLY_PROD },

    { complaints: enrollment.enrollmentWarnings, fatalIn: NEVER },
    { complaints: contests.catalogueWarnings, fatalIn: NEVER },
    { complaints: contests.contestWarnings, fatalIn: NEVER },
    { complaints: authz.policyWarnings, fatalIn: NEVER },
    {
      complaints: () =>
        access.undeclaredBackends().map(
          (id) =>
            `题目 ${access.problemsServedBy(id).join("、")} 指向的题目后端 "${id}"，` +
            `没有登记。`,
        ),
      fatalIn: NEVER,
    },
    { complaints: mailTemplates.mailTemplateWarnings, fatalIn: NEVER },
  ];
}

declare global {
  var __foiBootWarnings: string[] | undefined;
}

export function savedBootWarnings(): string[] {
  return globalThis.__foiBootWarnings ?? [];
}

export async function assertBootConfiguration(): Promise<void> {
  assertEnv();

  const current = tier();
  const sha = releaseSha();
  log.info(`环境 ${current}，构建自 ${sha ?? "未知 commit"}`);

  const refusals: string[] = [];
  const warnings: string[] = [];

  for (const check of await loadChecks()) {
    const into = check.fatalIn.includes(current) ? refusals : warnings;
    into.push(...check.complaints());
  }

  globalThis.__foiBootWarnings = warnings;

  for (const warning of warnings) log.warn(warning);

  if (refusals.length === 0) return;

  refuse(`配置不完整（环境 ${current}）:`, refusals);
}
