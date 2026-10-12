"use client";

import type { ReactNode } from "react";
import { VerdictBody } from "@/components/opaque";
import { JudgeProgress } from "@/components/problem/judge-progress";
import { useProblem } from "@/components/problem/problem-context";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { isSettled } from "@/lib/backend/types";
import { useSubmit } from "@/lib/submissions/use-submit";
import { SubmitProvider } from "./submit-context";

export function SubmitPanel({ children }: { children: ReactNode }) {
  const { config, permissions } = useProblem();
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
        {!permissions.submit.allowed ? (
          <p className="text-fg-muted text-sm">
            {permissions.submit.reason.code === "unauthenticated" ? (
              <>
                请先
                <a
                  className="text-fg decoration-border-strong hover:decoration-fg underline underline-offset-2"
                  href="/login"
                >
                  登录
                </a>
                后提交。
              </>
            ) : (
              permissions.submit.reason.message
            )}
          </p>
        ) : (
          <SubmitProvider value={{ submit, submitting }}>
            {children}
          </SubmitProvider>
        )}

        {error ? <p className="text-err mt-3 text-sm">{error}</p> : null}

        {submission && !isSettled(submission.state) ? (
          <div className="border-border mt-4 border-t pt-4">
            <JudgeProgress
              state={submission.state}
              status={submission.runnerStatus}
            />
          </div>
        ) : null}

        {submission?.reason ? (
          <p className="text-err border-err mt-4 border-l-2 pl-3 text-sm">
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
              className="text-fg-muted hover:text-fg text-xs underline-offset-2 transition-colors hover:underline"
            >
              查看提交详情
            </a>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
