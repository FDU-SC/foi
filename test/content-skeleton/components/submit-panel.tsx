"use client";

import { useState, type FormEvent } from "react";
import { VerdictBody } from "@/components/opaque/verdict-body";
import { useProblem } from "@/components/problem/problem-context";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Textarea } from "@/components/ui/field";
import { useSubmit } from "@/lib/submissions/use-submit";
import { problemUi } from "./ui-config";

/**
 * A submitter, built on the kernel's `useSubmit` like any other.
 *
 * The payload shape below is this content's convention and nothing upstream
 * agrees with it: `POST /api/submissions` takes any JSON object and stores it
 * without looking inside. Which is why the skeleton's is deliberately
 * different from the repository's — `{ text }` for everything, no language
 * picker, no `{ flag }` — so that a kernel that had grown to expect
 * `{ language, source }` would show it here.
 */
export function SubmitPanel() {
  const { config, canAct } = useProblem();
  const { submit, submission, submitting, error } = useSubmit();
  const [value, setValue] = useState("");

  const ui = problemUi(config);
  if (ui.submit === "none") return null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    void submit({ text: value });
  };

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
          <p className="text-fg-muted text-sm">请先登录后提交。</p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            <Textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              rows={8}
              spellCheck={false}
              placeholder={ui.placeholder ?? "在此粘贴你的答案"}
            />
            {error ? <p className="text-err text-sm">{error}</p> : null}
            <Button
              type="submit"
              variant="primary"
              disabled={submitting || !value.trim()}
            >
              {submitting ? "提交中…" : "提交"}
            </Button>
          </form>
        )}

        {submission?.reason ? (
          <p className="text-err bg-err-subtle mt-4 rounded-md px-3 py-2 text-sm">
            {submission.reason}
          </p>
        ) : null}

        {submission?.verdict ? (
          <div className="border-border mt-4 border-t pt-4">
            <VerdictBody problemSlug={config.slug} verdict={submission.verdict} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
