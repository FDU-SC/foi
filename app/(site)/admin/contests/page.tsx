import { asc, desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm } from "@/components/admin/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/field";
import { db } from "@/lib/db";
import { contestProblems, contests } from "@/lib/db/schema";
import { listProblems } from "@/lib/problems/registry";
import { listRulesets } from "@/lib/standings/registry";
import { addContestProblemAction, createContestAction } from "../actions";

export const metadata: Metadata = { title: "比赛管理" };
export const dynamic = "force-dynamic";

const LABELS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";

function toLocalInput(date: Date): string {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export default async function AdminContestsPage() {
  const all = await db.select().from(contests).orderBy(desc(contests.startsAt));
  const attached = await db
    .select({
      contestId: contestProblems.contestId,
      slug: contestProblems.problemSlug,
      label: contestProblems.label,
    })
    .from(contestProblems)
    .orderBy(asc(contestProblems.order));

  const registry = listProblems({ includeHidden: true });
  const now = new Date();
  const inTwoHours = new Date(now.getTime() + 2 * 60 * 60 * 1000);

  return (
    <div className="space-y-6">
      <nav className="text-fg-subtle text-xs">
        <Link href="/admin" className="hover:text-fg transition-colors">
          管理
        </Link>
        <span className="mx-1.5">/</span>
        <span>比赛</span>
      </nav>

      <h1 className="text-fg text-2xl font-bold tracking-tight">比赛</h1>

      <Card>
        <CardHeader title="新建比赛" />
        <CardBody>
          <ActionForm action={createContestAction} submitLabel="创建">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="标识" hint="用于 URL，如 winter-2026">
                <Input name="slug" required autoComplete="off" />
              </Field>
              <Field label="标题">
                <Input name="title" required autoComplete="off" />
              </Field>
              <Field label="赛制">
                <Select name="rulesetId" defaultValue="oi">
                  {listRulesets().map((ruleset) => (
                    <option key={ruleset.id} value={ruleset.id}>
                      {ruleset.name}
                    </option>
                  ))}
                </Select>
              </Field>
              <div className="grid grid-cols-2 gap-3">
                <Field label="开始时间">
                  <Input
                    name="startsAt"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInput(now)}
                  />
                </Field>
                <Field label="结束时间">
                  <Input
                    name="endsAt"
                    type="datetime-local"
                    required
                    defaultValue={toLocalInput(inTwoHours)}
                  />
                </Field>
              </div>
            </div>
          </ActionForm>
        </CardBody>
      </Card>

      {all.map((contest) => {
        const own = attached.filter((row) => row.contestId === contest.id);
        return (
          <Card key={contest.id}>
            <CardHeader
              title={
                <span className="flex items-center gap-2">
                  <Link
                    href={`/contests/${contest.slug}`}
                    className="hover:text-primary transition-colors"
                  >
                    {contest.title}
                  </Link>
                  <Badge>{contest.rulesetId}</Badge>
                </span>
              }
              actions={
                <Link
                  href={`/contests/${contest.slug}/standings`}
                  className="text-fg-subtle hover:text-primary text-xs transition-colors"
                >
                  排行榜
                </Link>
              }
            />
            <CardBody className="space-y-3">
              {own.length > 0 ? (
                <ul className="flex flex-wrap gap-2">
                  {own.map((row) => (
                    <li key={row.slug}>
                      <Badge tone="primary" mono>
                        {row.label}. {row.slug}
                      </Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-fg-subtle text-xs">尚未添加题目。</p>
              )}

              <ActionForm
                action={addContestProblemAction}
                submitLabel="添加题目"
                className="border-border border-t pt-3"
              >
                <input type="hidden" name="contestId" value={contest.id} />
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="题目">
                    <Select name="problemSlug">
                      {registry.map((problem) => (
                        <option key={problem.slug} value={problem.slug}>
                          {problem.title} ({problem.slug})
                        </option>
                      ))}
                    </Select>
                  </Field>
                  <Field label="编号">
                    <Input
                      name="label"
                      defaultValue={LABELS[own.length] ?? String(own.length + 1)}
                      required
                      autoComplete="off"
                    />
                  </Field>
                </div>
              </ActionForm>
            </CardBody>
          </Card>
        );
      })}
    </div>
  );
}
