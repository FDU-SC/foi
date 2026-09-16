import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getViewer } from "@/auth";
import { contestFor } from "@/lib/contests/access";
import { dateFormatter } from "@/lib/format";
import { rulesetFor } from "@/lib/standings/registry";

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
    <section className="bg-surface border-border space-y-5 rounded-lg border p-4 sm:p-6">
      <h2 className="text-lg font-semibold">比赛概览</h2>
      {contest.description ? <p className="text-fg-muted text-sm leading-6">{contest.description}</p> : null}
      <div className="oj-sidebar">
        <dl className="sm:grid-cols-2">
          <div><dt>开始时间</dt><dd>{formatter.format(contest.startsAt)}</dd></div>
          <div><dt>结束时间</dt><dd>{formatter.format(contest.endsAt)}</dd></div>
          {contest.freezeAt ? <div><dt>封榜时间</dt><dd>{formatter.format(contest.freezeAt)}</dd></div> : null}
          <div><dt>赛制</dt><dd>{ruleset?.name ?? primaryLb.ruleset.id}</dd></div>
        </dl>
      </div>
      {ruleset ? <p className="text-fg-muted text-sm leading-6">{ruleset.description}</p> : null}
    </section>
  );
}
