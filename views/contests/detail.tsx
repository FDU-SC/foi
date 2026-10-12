import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { contestFor } from "@/lib/contests/access";
import { dateFormatter } from "@/lib/format";
import { rulesetFor } from "@/lib/standings/registry";
import styles from "@/components/contests/workspace.module.css";

const formatter = dateFormatter({ dateStyle: "medium", timeStyle: "short" });

export async function contestDetailMetadata({ params }: PageProps<"/contests/[slug]">): Promise<Metadata> {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  return { title: view?.config.title ?? "比赛" };
}

export async function ContestDetailView({ params }: PageProps<"/contests/[slug]">) {
  const { slug } = await params;
  const view = contestFor(slug, await getViewer());
  if (!view) notFound();
  const contest = view.config;
  const primaryLb = contest.leaderboards[0];
  const ruleset = rulesetFor(primaryLb.ruleset.id);

  return (
    <section className={styles.panel}>
      <div className="max-w-2xl space-y-5 pt-1">
        {contest.description ? <p className="text-fg text-sm leading-6">{contest.description}</p> : null}
        <dl className="grid gap-4 text-sm sm:grid-cols-2">
          <div><dt className="text-fg-muted mb-1 text-xs">开始时间</dt><dd className="tabular-nums"><time dateTime={contest.startsAt.toISOString()}>{formatter.format(contest.startsAt)}</time></dd></div>
          <div><dt className="text-fg-muted mb-1 text-xs">结束时间</dt><dd className="tabular-nums"><time dateTime={contest.endsAt.toISOString()}>{formatter.format(contest.endsAt)}</time></dd></div>
          <div><dt className="text-fg-muted mb-1 text-xs">赛制</dt><dd className="font-medium">{ruleset?.name ?? primaryLb.ruleset.id}</dd></div>
          {contest.freezeAt ? <div><dt className="text-fg-muted mb-1 text-xs">封榜时间</dt><dd className="tabular-nums"><time dateTime={contest.freezeAt.toISOString()}>{formatter.format(contest.freezeAt)}</time></dd></div> : null}
        </dl>
        {ruleset ? <p className="text-fg-muted border-border border-t pt-4 text-sm leading-6">{ruleset.description}</p> : null}
      </div>
    </section>
  );
}
