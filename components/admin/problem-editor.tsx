"use client";

import { useActionState, useState, type ReactNode } from "react";
import {
  deleteProblemAction,
  publishProblemAction,
  saveProblemAction,
  unpublishProblemAction,
  type AuthorState,
} from "@/app/(site)/admin/problems/actions";
import { ActionResult, PendingSubmit } from "@/components/form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/field";
import { listPresets, listUiFields } from "@/lib/authoring/registry";
import type { UiField } from "@/lib/authoring/types";
import type { DraftIssues } from "@/lib/problems/draft";

/**
 * The authoring form: parameters, test points, belonging and statement.
 *
 * The judge files are uploaded above it, and three of the fields below are
 * choices from what was uploaded rather than typed names — an author picking
 * `run.sh` from a list cannot misspell it, and the validator does not have to
 * explain a typo afterwards.
 *
 * Nothing here decides anything: it collects, and the actions behind it check.
 */

export interface CaseDraft {
  name: string;

  /**
   * The raw text of the field, not a parsed list.
   *
   * Parsing happens once, in the action, so the two notations — space-separated
   * and a pasted JSON array — are read in one place. A field that re-parsed on
   * every keystroke would also fight the clipboard.
   */
  argv: string;

  threads?: number;
  timeLimitMs: number;
  maxScore: number;
}

export interface ContestChoice {
  slug: string;
  title: string;
  domain?: string;
}

export interface EditorDraft {
  title: string;
  maxScore: number;
  statementMdx: string;
  ui: Record<string, unknown>;
  viewsPreset: string;
  script: string;
  contestant: string;
  shell?: string;
  memoryLimitMb: number;
  maxFileMb: number;

  /** Absent means the judge's own default, which is a real choice here. */
  stackLimitMb?: number;
  addressSpace?: "bounded" | "unbounded";
  seed?: number;

  resultRequired: boolean;
  cases: CaseDraft[];
  contests: { slug: string; label?: string }[];
}

const SEED_PLACEHOLDER = "${JOB_ID_SHA16}";

function emptyCase(): CaseDraft {
  return { name: "", argv: "", threads: undefined, timeLimitMs: 10_000, maxScore: 10 };
}

function uiFieldValue(field: UiField, ui: Record<string, unknown>): string {
  const value = ui[field.key];
  if (value === undefined) return "";
  if (Array.isArray(value)) return value.join(", ");
  return String(value);
}

function withUiValue(
  field: UiField,
  raw: string,
  ui: Record<string, unknown>,
): Record<string, unknown> {
  const next = { ...ui };

  if (raw.trim().length === 0) {
    delete next[field.key];
    return next;
  }

  if (field.kind === "tags" || field.kind === "multi") {
    next[field.key] = raw
      .split(/[,，]/)
      .map((one) => one.trim())
      .filter((one) => one.length > 0);
  } else {
    next[field.key] = raw;
  }

  return next;
}

export function ProblemEditor({
  slug,
  draft,
  files,
  contests,
  published,
  issues,
  submissionsHeld,
  preview,
}: {
  slug: string;
  draft: EditorDraft;
  files: string[];
  contests: ContestChoice[];
  published: boolean;
  issues: DraftIssues;

  /** Submissions naming this problem. Deleting it takes them with it. */
  submissionsHeld: number;

  /** Rendered by the page from the stored statement, and updated when it is saved. */
  preview: ReactNode;
}) {
  const [saveState, save] = useActionState<AuthorState, FormData>(saveProblemAction, {});
  const [publishState, publish] = useActionState<AuthorState, FormData>(
    publishProblemAction,
    {},
  );
  const [unpublishState, unpublish] = useActionState<AuthorState, FormData>(
    unpublishProblemAction,
    {},
  );
  const [removeState, remove] = useActionState<AuthorState, FormData>(
    deleteProblemAction,
    {},
  );

  const [cases, setCases] = useState<CaseDraft[]>(
    draft.cases.length > 0 ? draft.cases : [emptyCase()],
  );
  const [ui, setUi] = useState<Record<string, unknown>>(draft.ui);
  const [selected, setSelected] = useState<{ slug: string; label?: string }[]>(
    draft.contests,
  );

  const shown = saveState.issues ?? issues;
  const fields = listUiFields();
  const presets = listPresets();

  // A file the parameters still name but that is no longer uploaded is worth
  // showing rather than silently dropping out of the select.
  function optionsFor(stored: string): string[] {
    return stored.length > 0 && !files.includes(stored) ? [stored, ...files] : files;
  }

  function moveContest(index: number, delta: number) {
    const to = index + delta;
    if (to < 0 || to >= selected.length) return;
    const next = [...selected];
    [next[index], next[to]] = [next[to]!, next[index]!];
    setSelected(next);
  }

  return (
    <div className="space-y-4">
      <form action={save} className="space-y-4">
        <input type="hidden" name="slug" value={slug} />
        <input type="hidden" name="ui" value={JSON.stringify(ui)} />

        <Card>
          <CardHeader title="基本" />
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="标题">
                <Input name="title" defaultValue={draft.title} required maxLength={120} />
              </Field>
              <Field label="总分">
                <Input
                  name="maxScore"
                  type="number"
                  min={1}
                  step={1}
                  defaultValue={draft.maxScore}
                  required
                />
              </Field>
            </div>

            <Field label="展示 preset" hint="题面之外的显示方式，由平台提供。">
              <Select name="viewsPreset" defaultValue={draft.viewsPreset}>
                {presets.map((preset) => (
                  <option key={preset.id} value={preset.id}>
                    {preset.label} —— {preset.description}
                  </option>
                ))}
              </Select>
            </Field>

            {fields.length === 0 ? null : (
              <div className="grid gap-3 sm:grid-cols-2">
                {fields.map((field) => (
                  <Field
                    key={field.key}
                    label={field.label}
                    hint={field.hint}
                  >
                    {field.kind === "choice" ? (
                      <Select
                        value={uiFieldValue(field, ui)}
                        onChange={(event) =>
                          setUi(withUiValue(field, event.target.value, ui))
                        }
                      >
                        <option value="">不填</option>
                        {field.options.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </Select>
                    ) : (
                      <Input
                        value={uiFieldValue(field, ui)}
                        placeholder={field.kind === "text" ? field.placeholder : undefined}
                        onChange={(event) =>
                          setUi(withUiValue(field, event.target.value, ui))
                        }
                      />
                    )}
                  </Field>
                ))}
              </div>
            )}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="判题" />
          <CardBody className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="判题脚本" hint="判题机在每个测试点里跑它，读它输出的 FOI_RESULT 行。">
                <Select name="script" defaultValue={draft.script} required>
                  <option value="">选择文件</option>
                  {optionsFor(draft.script).map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="选手提交落点" hint="选手的代码写进这个文件。">
                <Select name="contestant" defaultValue={draft.contestant} required>
                  <option value="">选择文件</option>
                  {optionsFor(draft.contestant).map((path) => (
                    <option key={path} value={path}>
                      {path}
                    </option>
                  ))}
                </Select>
              </Field>
              <Field label="内存上限 (MiB)" hint="判题机按它给整个脚本设 ulimit -v。">
                <Input
                  name="memoryLimitMb"
                  type="number"
                  min={1}
                  defaultValue={draft.memoryLimitMb}
                  required
                />
              </Field>
              <Field label="单文件上限 (MiB)" hint="生成的数据超过它会被判题机截断。">
                <Input
                  name="maxFileMb"
                  type="number"
                  min={1}
                  defaultValue={draft.maxFileMb}
                  required
                />
              </Field>
              <Field
                label="解释器"
                hint="判题机用它执行判题脚本。留空即 sh；这里填的是 sh、bash 这类程序名，不是脚本名。"
              >
                <Input name="shell" defaultValue={draft.shell ?? ""} maxLength={40} placeholder="sh" />
              </Field>
              <Field
                label="每线程栈上限 (MiB)"
                hint="判题机按「内存上限 + 线程数 × 它 + 16」推导地址空间，所以两者不是独立的。留空即 shell 的默认栈。"
              >
                <Input
                  name="stackLimitMb"
                  type="number"
                  min={1}
                  defaultValue={draft.stackLimitMb ?? ""}
                  placeholder="默认"
                />
              </Field>
              <Field
                label="地址空间"
                hint="受限能挡住乱申请内存的提交；不受限给那些一启动就预留一大片地址空间、却几乎不碰的运行时。"
              >
                <Select name="addressSpace" defaultValue={draft.addressSpace ?? ""}>
                  <option value="">默认（受限）</option>
                  <option value="bounded">受限</option>
                  <option value="unbounded">不受限</option>
                </Select>
              </Field>
              <Field
                label="隐藏种子"
                hint="每份提交的隐藏值由它和提交编号共同决定；改掉它等于一次换掉所有隐藏值。留空即判题机的默认。"
              >
                <Input
                  name="seed"
                  type="number"
                  min={1}
                  defaultValue={draft.seed ?? ""}
                  placeholder="默认"
                />
              </Field>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  name="resultRequired"
                  defaultChecked={draft.resultRequired}
                  className="mt-1"
                />
                <span>
                  判题脚本必须报告结果
                  <span className="text-fg-subtle block text-xs">
                    不勾选时，脚本没报告结果就按 0 分处理，而不是报成评测中断。
                  </span>
                </span>
              </label>
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title="测试点"
            actions={
              <Button
                type="button"
                size="sm"
                onClick={() => setCases([...cases, emptyCase()])}
              >
                添加
              </Button>
            }
          />
          <CardBody className="space-y-4">
            {cases.map((one, index) => (
              <div key={index} className="border-border space-y-2 border-t pt-3 first:border-t-0 first:pt-0">
                <div className="grid gap-3 sm:grid-cols-4">
                  <Field label="名称">
                    <Input
                      name={`cases.${index}.name`}
                      value={one.name}
                      onChange={(event) => {
                        const next = [...cases];
                        next[index] = { ...one, name: event.target.value };
                        setCases(next);
                      }}
                      maxLength={80}
                      required
                    />
                  </Field>
                  <Field label="时间预算 (ms)" hint="整个测试点的挂钟预算，比题面限制宽。">
                    <Input
                      name={`cases.${index}.timeLimitMs`}
                      type="number"
                      min={1}
                      value={one.timeLimitMs}
                      onChange={(event) => {
                        const next = [...cases];
                        next[index] = { ...one, timeLimitMs: Number(event.target.value) };
                        setCases(next);
                      }}
                      required
                    />
                  </Field>
                  <Field label="分值">
                    <Input
                      name={`cases.${index}.maxScore`}
                      type="number"
                      min={0}
                      value={one.maxScore}
                      onChange={(event) => {
                        const next = [...cases];
                        next[index] = { ...one, maxScore: Number(event.target.value) };
                        setCases(next);
                      }}
                      required
                    />
                  </Field>
                  <Field label="线程数" hint="留空按判题机默认。">
                    <Input
                      name={`cases.${index}.threads`}
                      type="number"
                      min={1}
                      value={one.threads ?? ""}
                      onChange={(event) => {
                        const next = [...cases];
                        next[index] = {
                          ...one,
                          threads:
                            event.target.value === "" ? undefined : Number(event.target.value),
                        };
                        setCases(next);
                      }}
                    />
                  </Field>
                </div>

                <Field
                  label="argv"
                  hint={`按空格分隔，也可以直接粘 problem.ts 里那种 JSON 数组。${SEED_PLACEHOLDER} 会替换成本次提交的隐藏种子。`}
                >
                  <Input
                    name={`cases.${index}.argv`}
                    value={one.argv}
                    onChange={(event) => {
                      const next = [...cases];
                      next[index] = { ...one, argv: event.target.value };
                      setCases(next);
                    }}
                  />
                </Field>

                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      const next = [...cases];
                      const grown = one.argv.trim();
                      next[index] = {
                        ...one,
                        argv: grown.length === 0 ? SEED_PLACEHOLDER : `${grown} ${SEED_PLACEHOLDER}`,
                      };
                      setCases(next);
                    }}
                  >
                    插入 {SEED_PLACEHOLDER}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => setCases(cases.filter((_, at) => at !== index))}
                    disabled={cases.length === 1}
                  >
                    删除本行
                  </Button>
                </div>
              </div>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="归属比赛" />
          <CardBody className="space-y-3">
            <p className="text-fg-subtle text-xs">
              题目必须属于至少一场比赛，顺序即题目在比赛里的顺序。
            </p>

            <div className="flex flex-wrap gap-2">
              {contests.map((contest) => {
                const chosen = selected.find((one) => one.slug === contest.slug);
                return (
                  <Button
                    key={contest.slug}
                    type="button"
                    size="sm"
                    variant={chosen ? "primary" : "secondary"}
                    onClick={() =>
                      setSelected(
                        chosen
                          ? selected.filter((one) => one.slug !== contest.slug)
                          : [...selected, { slug: contest.slug }],
                      )
                    }
                  >
                    {contest.domain ? `${contest.domain} · ` : ""}
                    {contest.title}
                  </Button>
                );
              })}
            </div>

            {selected.length === 0 ? (
              <p className="text-warn text-xs">还没有选择比赛。</p>
            ) : (
              <ol className="space-y-2">
                {selected.map((link, index) => {
                  const contest = contests.find((one) => one.slug === link.slug);
                  return (
                    <li key={link.slug} className="flex flex-wrap items-center gap-2">
                      <span className="text-fg-muted w-6 font-mono text-xs tabular-nums">
                        {index + 1}
                      </span>
                      <Badge mono>{link.slug}</Badge>
                      <span className="text-fg text-sm">
                        {contest?.title ?? "（比赛不存在）"}
                      </span>
                      <Input
                        name={`contestLabels.${link.slug}`}
                        value={link.label ?? ""}
                        placeholder="编号，如 A"
                        maxLength={8}
                        className="h-7 w-24 text-xs"
                        aria-label={`${link.slug} 的编号`}
                        onChange={(event) => {
                          const next = [...selected];
                          next[index] = { slug: link.slug, label: event.target.value };
                          setSelected(next);
                        }}
                      />
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => moveContest(index, -1)}
                        disabled={index === 0}
                      >
                        上移
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => moveContest(index, 1)}
                        disabled={index === selected.length - 1}
                      >
                        下移
                      </Button>
                    </li>
                  );
                })}
              </ol>
            )}

            {selected.map((link) => (
              <input key={link.slug} type="hidden" name="contests" value={link.slug} />
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="题面" />
          <CardBody className="space-y-3">
            <p className="text-fg-subtle text-xs">
              Markdown。组件已经全部可用，直接写 &lt;Callout&gt;、&lt;Constraints&gt;、
              &lt;Sample&gt;、&lt;SubmitPanel&gt;、&lt;CodeInput&gt; 即可，不需要 import。
              $ 与 $$ 里的公式按 KaTeX 排版。预览用的是与线上同一套渲染，保存后更新。
            </p>
            <Textarea
              name="statementMdx"
              defaultValue={draft.statementMdx}
              rows={18}
              spellCheck={false}
            />
            <div className="border-border max-h-[32rem] overflow-auto border p-3">
              {preview}
            </div>
          </CardBody>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <PendingSubmit pendingLabel="保存中…">保存</PendingSubmit>
          <ActionResult state={saveState} />
        </div>
      </form>

      <Card>
        <CardHeader title="状态" />
        <CardBody className="space-y-3">
          <p className="text-fg-muted text-sm">
            当前状态：{published ? "已发布" : "草稿"}
            {published ? "，选手已能在所属比赛里打开。" : "，只有运维台看得到。"}
          </p>

          {shown.errors.length > 0 ? (
            <ul className="space-y-1">
              {shown.errors.map((issue) => (
                <li key={issue} className="text-err border-err border-l-2 py-0.5 pl-3 text-sm">
                  {issue}
                </li>
              ))}
            </ul>
          ) : null}

          {shown.warnings.length > 0 ? (
            <ul className="space-y-1">
              {shown.warnings.map((issue) => (
                <li key={issue} className="text-warn border-warn border-l-2 py-0.5 pl-3 text-sm">
                  {issue}
                </li>
              ))}
            </ul>
          ) : null}

          <div className="flex flex-wrap items-center gap-3">
            {published ? (
              <form action={unpublish}>
                <input type="hidden" name="slug" value={slug} />
                <PendingSubmit variant="secondary" pendingLabel="下架中…">
                  下架
                </PendingSubmit>
                <ActionResult state={unpublishState} className="ml-3" />
              </form>
            ) : (
              <form action={publish}>
                <input type="hidden" name="slug" value={slug} />
                <PendingSubmit variant="primary" pendingLabel="发布中…">
                  发布
                </PendingSubmit>
                <ActionResult state={publishState} className="ml-3" />
              </form>
            )}
          </div>

          <p className="text-fg-subtle text-xs">
            发布前请先保存：发布的是已经存下来的内容。
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="删除" />
        <CardBody>
          <form action={remove}>
            <input type="hidden" name="slug" value={slug} />
            <PendingSubmit variant="danger" pendingLabel="删除中…">
              删除这道题
            </PendingSubmit>
          </form>
          <ActionResult state={removeState} className="mt-2" />
          <p className="text-fg-subtle mt-2 text-xs">
            删除会连同判题文件与归属关系一起移除
            {submissionsHeld > 0
              ? `，以及 ${submissionsHeld} 份提交记录（含排队与评测记录）`
              : ""}
            。
          </p>
        </CardBody>
      </Card>
    </div>
  );
}
