"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useProblem } from "@/components/problem/problem-context";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { VerdictDetail } from "@/components/problem/verdict-detail";
import { LANGUAGES } from "@/lib/problems/types";
import { useSubmit } from "@/lib/submissions/use-submit";

const DEFAULT_LANGUAGES = ["cpp", "python"];

/**
 * The stock submitter, registered globally so a statement can just write
 * `<SubmitPanel />`. It covers code and single-value submissions; problems
 * needing anything else set `submit.kind` to `"none"` and render their own
 * component built on `useSubmit()`.
 */
export function SubmitPanel({
  kind: kindOverride,
}: {
  kind?: "code" | "flag" | "text";
}) {
  const { config, canAct } = useProblem();
  const { submit, submission, submitting, error } = useSubmit();

  const kind = kindOverride ?? config.submit.kind;
  const languages = config.submit.languages ?? DEFAULT_LANGUAGES;

  const [language, setLanguage] = useState(languages[0] ?? "cpp");
  const [value, setValue] = useState("");

  if (kind === "none") return null;

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    if (!value.trim()) return;
    const payload =
      kind === "code"
        ? { language, source: value }
        : kind === "flag"
          ? { flag: value.trim() }
          : { text: value };
    void submit(payload);
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
          <p className="text-fg-muted text-sm">
            请先<a className="text-primary underline underline-offset-2" href="/login">登录</a>后提交。
          </p>
        ) : (
          <form onSubmit={onSubmit} className="space-y-3">
            {kind === "code" ? (
              <>
                <div className="flex items-center gap-2">
                  <Select
                    value={language}
                    onChange={(e) => setLanguage(e.target.value)}
                    className="w-40"
                  >
                    {languages.map((id) => (
                      <option key={id} value={id}>
                        {LANGUAGES[id] ?? id}
                      </option>
                    ))}
                  </Select>
                </div>
                <Textarea
                  value={value}
                  onChange={(e) => setValue(e.target.value)}
                  rows={12}
                  spellCheck={false}
                  placeholder={config.submit.placeholder ?? "在此粘贴你的代码"}
                />
              </>
            ) : kind === "flag" ? (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                placeholder={config.submit.placeholder ?? "flag{...}"}
              />
            ) : (
              <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={6}
                placeholder={config.submit.placeholder}
              />
            )}

            {error ? <p className="text-err text-sm">{error}</p> : null}

            <div className="flex items-center gap-3">
              <Button
                type="submit"
                variant="primary"
                disabled={submitting || !value.trim()}
              >
                {submitting ? "提交中…" : "提交"}
              </Button>
              {submission ? (
                <a
                  href={`/submissions/${submission.id}`}
                  className="text-fg-subtle hover:text-fg text-xs transition-colors"
                >
                  查看提交详情
                </a>
              ) : null}
            </div>
          </form>
        )}

        {/*
          The badge above says 评测失败 for both `failed` and `abandoned`, on
          purpose — see `STATE_PRESETS`. This line is the only place the two
          differ in front of a player, and it is the difference that decides
          what to do next: a refusal will refuse the same submission again, a
          timeout says nothing about the submission and is worth retrying.
        */}
        {submission?.reason ? (
          <p className="text-err bg-err-subtle mt-4 rounded-md px-3 py-2 text-sm">
            {submission.reason}
          </p>
        ) : null}

        {submission?.verdict ? (
          <div className="border-border mt-4 border-t pt-4">
            <VerdictDetail verdict={submission.verdict} />
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
