import Link from "next/link";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { contestsFor } from "@/lib/contests/access";
import { contestPhase, PHASE_LABEL, PHASE_TONE } from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { rulesetFor } from "@/lib/standings/registry";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

export async function ContestListView() {
  const all = contestsFor(await getViewer());

  return (
    <div className="space-y-5">
      <h1 className="text-fg text-2xl font-bold tracking-tight">比赛</h1>

      {all.length === 0 ? (
        <p className="text-fg-subtle border-border rounded-lg border py-16 text-center text-sm">
          还没有比赛。在 <code className="font-mono">content/contests/</code>{" "}
          下新建一个目录即可。
        </p>
      ) : (
        <ul className="border-border divide-border divide-y overflow-hidden rounded-lg border">
          {all.map(({ config: contest, preview }) => {
            const phase = contestPhase(contest);
            return (
              <li key={contest.slug}>
                <Link
                  href={`/contests/${contest.slug}`}
                  className="hover:bg-surface-2 flex flex-wrap items-center gap-3 px-4 py-3.5 transition-colors"
                >
                  <Badge tone={PHASE_TONE[phase]}>{PHASE_LABEL[phase]}</Badge>
                  <span className="text-fg font-medium">{contest.title}</span>
                  {preview ? <Badge tone="warn">未公开</Badge> : null}
                  <Badge>
                    {rulesetFor(contest.leaderboards[0].ruleset.id)?.name ??
                      "自定义赛制"}
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
