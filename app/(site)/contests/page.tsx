import type { Metadata } from "next";
import Link from "next/link";
import { Badge, type BadgeTone } from "@/components/ui/badge";
import {
  contestPhase,
  listContests,
  PHASE_LABEL,
  type ContestPhase,
} from "@/lib/contests/queries";
import { getRuleset } from "@/lib/standings/registry";

export const metadata: Metadata = { title: "比赛" };
export const dynamic = "force-dynamic";

const PHASE_TONE: Record<ContestPhase, BadgeTone> = {
  upcoming: "info",
  running: "ok",
  ended: "neutral",
};

const formatter = new Intl.DateTimeFormat("zh-CN", {
  dateStyle: "medium",
  timeStyle: "short",
});

export default async function ContestsPage() {
  const all = await listContests();

  return (
    <div className="space-y-5">
      <h1 className="text-fg text-2xl font-bold tracking-tight">比赛</h1>

      {all.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有比赛。管理员可以在后台创建。
        </p>
      ) : (
        <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
          {all.map((contest) => {
            const phase = contestPhase(contest);
            return (
              <li key={contest.id}>
                <Link
                  href={`/contests/${contest.slug}`}
                  className="hover:bg-surface-2 flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors"
                >
                  <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
                  <span className="text-fg font-medium">{contest.title}</span>
                  <Badge>
                    {getRuleset(contest.rulesetId)?.name ?? contest.rulesetId}
                  </Badge>
                  <span className="text-fg-subtle ml-auto font-mono text-xs">
                    {formatter.format(contest.startsAt)}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
