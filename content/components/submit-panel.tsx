"use client";

import { useState, type FormEvent } from "react";
import { VerdictBody } from "@/components/opaque";
import { useProblem } from "@/components/problem/problem-context";
import { QueueBadge } from "@/components/problem/queue-position";
import { VerdictBadge } from "@/components/problem/verdict-badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/field";
import { useSubmit } from "@/lib/submissions/use-submit";
import { problemUi, type SubmitKind } from "./ui-config";

const LANGUAGES: Record<string, string> = {
  c: "C",
  cpp: "C++",
  python: "Python",
  java: "Java",
  rust: "Rust",
  go: "Go",
  javascript: "JavaScript",
};

const DEFAULT_LANGUAGES = ["cpp", "python"];

export function SubmitPanel({ kind: kindOverride }: { kind?: SubmitKind }) {
  const { config, canAct } = useProblem();
  const { submit, submission, submitting, error } = useSubmit();

  const ui = problemUi(config);
  const kind = kindOverride ?? ui.submit;
  const languages = ui.languages ?? DEFAULT_LANGUAGES;

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
                  placeholder={ui.placeholder ?? "在此粘贴你的代码"}
                />
              </>
            ) : kind === "flag" ? (
              <Input
                value={value}
                onChange={(e) => setValue(e.target.value)}
                spellCheck={false}
                autoComplete="off"
                className="font-mono"
                placeholder={ui.placeholder ?? "flag{...}"}
              />
            ) : (
              <Textarea
                value={value}
                onChange={(e) => setValue(e.target.value)}
                rows={6}
                placeholder={ui.placeholder}
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
