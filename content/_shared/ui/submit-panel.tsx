"use client";

import type { ReactNode } from "react";
import { VerdictBody } from "@/components/opaque";
import { JudgeProgress } from "@/components/problem/judge-progress";
import { useProblem } from "@/components/problem/problem-context";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictReveal } from "@/components/problem/verdict-reveal";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { revealClass } from "@/components/ui/reveal";
import { isSettled } from "@/lib/backend/types";
import { useSubmit } from "@/lib/submissions/use-submit";
import { cn } from "@/lib/utils";
import { SubmitProvider } from "./submit-context";

export function SubmitPanel({ children }: { children: ReactNode }) {
  const { config, canAct, blocked } = useProblem();
  const { submit, submission, submitting, error } = useSubmit();

  return (
    <Card className="my-6">
      <CardHeader
        title="提交"
        actions={
          submission ? (
            <span className="flex items-center gap-2">
              <QueueBadge queue={submission.queue} />
              <VerdictReveal submission={submission} />
            </span>
          ) : null
        }
      />
      <CardBody>
        {!canAct ? (
          <p className="text-fg-muted text-sm">
            {blocked?.code === "unauthenticated" ? (
              <>
                请先
                <a
                  className="text-primary underline underline-offset-2"
                  href="/login"
                >
                  登录
                </a>
                后提交。
              </>
            ) : (
              (blocked?.message ?? "这道题现在不接受提交。")
            )}
          </p>
        ) : (
          <SubmitProvider value={{ submit, submitting }}>
            {children}
          </SubmitProvider>
        )}

        {error ? (
          <p className={cn("text-err text-sm", revealClass)}>{error}</p>
        ) : null}

        {submission && !isSettled(submission.state) ? (
          <div className="border-border mt-4 border-t pt-4">
            <JudgeProgress
              state={submission.state}
              status={submission.runnerStatus}
            />
          </div>
        ) : null}

        {submission?.reason ? (
          <p
            className={cn(
              "text-err bg-err-subtle mt-4 rounded-md px-3 py-2 text-sm",
              revealClass,
            )}
          >
            {submission.reason}
          </p>
        ) : null}

        {submission?.detail ? (
          <div
            className={cn("border-border mt-4 border-t pt-4", revealClass)}
          >
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
