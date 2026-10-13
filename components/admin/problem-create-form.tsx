"use client";

import { useActionState } from "react";
import {
  createProblemAction,
  type AuthorState,
} from "@/app/(site)/admin/problems/actions";
import { ActionResult, PendingSubmit } from "@/components/form";
import { Field, Input } from "@/components/ui/field";

/**
 * Start a problem.
 *
 * A slug and a title are all that is asked for here; the editor that follows is
 * where its files, parameters and statement go. Creating the row first is what
 * lets the files be uploaded against a problem rather than held in the browser
 * until everything else is ready.
 */
export function ProblemCreateForm() {
  const [state, formAction] = useActionState<AuthorState, FormData>(
    createProblemAction,
    {},
  );

  return (
    <form action={formAction} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-[minmax(0,16rem)_minmax(0,1fr)]">
        <Field label="标识" hint="小写字母、数字和连字符，题目地址里用它。">
          <Input name="slug" required maxLength={64} placeholder="a-plus-b" />
        </Field>
        <Field label="标题">
          <Input name="title" required maxLength={120} placeholder="A + B" />
        </Field>
      </div>

      <div className="flex items-center gap-3">
        <PendingSubmit pendingLabel="创建中…">新建题目</PendingSubmit>
        <ActionResult state={state} />
      </div>
    </form>
  );
}
