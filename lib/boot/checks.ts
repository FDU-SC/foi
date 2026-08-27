import { assertEnv } from "@/lib/env";
import { releaseSha, tier, type Tier } from "./deployment";

export interface Check {

  complaints: () => string[];

  fatalIn: readonly Tier[];
}

const ONLY_PROD = ["prod"] as const;
const NEVER = [] as const;

async function loadChecks(): Promise<Check[]> {
  const [backend, access, mail, mailTemplates, enrollment, contests, problems] =
    await Promise.all([
      import("@/lib/backend/boot"),
      import("@/lib/backend/access"),
      import("@/lib/mail/transport"),
      import("@/lib/mail/registry"),
      import("@/lib/enrollment/registry"),
      import("@/lib/contests/registry"),
      import("@/lib/problems/access"),
    ]);

  return [

    { complaints: mail.mailDeliveryComplaints, fatalIn: ONLY_PROD },

    { complaints: backend.backendsSharingSecret, fatalIn: ONLY_PROD },

    { complaints: backend.backendsMissingActionUrl, fatalIn: ONLY_PROD },

    { complaints: enrollment.enrollmentWarnings, fatalIn: NEVER },
    { complaints: contests.contestWarnings, fatalIn: NEVER },
    { complaints: problems.problemGateWarnings, fatalIn: NEVER },
    {
      complaints: () =>
        access.undeclaredBackends().map(
          (id) =>
            `题目 ${access.problemsServedBy(id).join("、")} 指向了没有登记的题目后端 "${id}"，` +
            `提交到这些题会失败。在 content/backends.ts 里补一个条目，或改掉题目的 backend.id`,
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
  console.log(
    `[foi] 环境 ${current}，构建自 ${sha ?? "未知 commit（非 CI 构建）"}`,
  );

  const refusals: string[] = [];
  const warnings: string[] = [];

  for (const check of await loadChecks()) {
    const into = check.fatalIn.includes(current) ? refusals : warnings;
    into.push(...check.complaints());
  }

  globalThis.__foiBootWarnings = warnings;

  for (const warning of warnings) console.warn(`[foi] ${warning}`);

  if (refusals.length === 0) return;

  throw new Error(
    `配置不完整，拒绝启动（环境 ${current}）:\n` +
      refusals.map((refusal) => `  - ${refusal}`).join("\n"),
  );
}
