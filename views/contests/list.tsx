import Link from "next/link";
import { getViewer } from "@/auth";
import { Badge } from "@/components/ui/badge";
import { revealClass, revealDelay } from "@/components/ui/reveal";
import { contestsFor } from "@/lib/contests/access";
import { contestStatus } from "@/lib/contests/types";
import { dateFormatter } from "@/lib/format";
import { rulesetFor } from "@/lib/standings/registry";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

export async function ContestListView() {
  const all = contestsFor(await getViewer());

  return (
    <div className="space-y-5">
      <h1 className="text-fg text-2xl font-bold tracking-tight">比赛</h1>

      {all.length === 0 ? (
        <p className="text-fg-subtle border-border bg-surface/70 rounded-xl border py-16 text-center text-sm backdrop-blur-sm">
          还没有比赛。在 <code className="font-mono">content/contests/</code>{" "}
          下新建一个目录即可。
        </p>
      ) : (
        <ul className="border-border divide-border bg-surface/70 divide-y overflow-hidden rounded-xl border backdrop-blur-sm">
          {all.map(({ config: contest, preview }, index) => {
            const status = contestStatus(contest);
            return (
              <li
                key={contest.slug}
                style={revealDelay(index)}
                className={revealClass}
              >
                <Link
                  href={`/contests/${contest.slug}`}
                  className="hover:bg-surface-2/80 flex flex-wrap items-center gap-3 px-4 py-3.5 shadow-[inset_3px_0_0_0_transparent] transition-[background-color,box-shadow] duration-200 hover:shadow-[inset_3px_0_0_0_var(--primary)]"
                >
                  <Badge tone={status.tone}>{status.label}</Badge>
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
