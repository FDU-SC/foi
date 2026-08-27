"use client";

import type { ReactNode } from "react";
import { VerdictBody } from "@/components/opaque";
import { useProblem } from "@/components/problem/problem-context";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { useSubmit } from "@/lib/submissions/use-submit";
import { SubmitProvider } from "./submit-context";

export function SubmitPanel({ children }: { children: ReactNode }) {
  const { config, canAct } = useProblem();
  const { submit, submission, submitting, error } = useSubmit();

  return (
    <Card className="my-6">
      <CardHeader
        title="提交"
        actions={
          submission ? (
            <span className="flex items-center gap-2">
              <QueueBadge queue={submission.queue} />
              <VerdictBadge submission={submission} />
            </span>
          ) : null
        }
      />
      <CardBody>
        {!canAct ? (
          <p className="text-fg-muted text-sm">
            请先
            <a
              className="text-primary underline underline-offset-2"
              href="/login"
            >
              登录
            </a>
            后提交。
          </p>
        ) : (
          <SubmitProvider value={{ submit, submitting }}>
            {children}
          </SubmitProvider>
        )}

        {error ? <p className="text-err text-sm">{error}</p> : null}

        {submission?.reason ? (
          <p className="text-err bg-err-subtle mt-4 rounded-md px-3 py-2 text-sm">
            {submission.reason}
          </p>
        ) : null}

        {submission?.detail ? (
          <div className="border-border mt-4 border-t pt-4">
            <VerdictBody problemSlug={config.slug} detail={submission.detail} />
          </div>
        ) : null}

        {submission && !submission.detail && !submission.reason ? (
          <div className="mt-3">
            <a
              href={`/submissions/${submission.id}`}
              className="text-fg-subtle hover:text-fg text-xs transition-colors"
            >
              查看提交详情
            </a>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
