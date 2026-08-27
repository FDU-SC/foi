"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/field";
import { useProblem } from "@/components/problem/problem-context";
import { problemUi } from "./ui-config";
import { useSubmitContext } from "./submit-context";

export function FlagInput() {
  const { config } = useProblem();
  const { submit, submitting } = useSubmitContext();
  const ui = problemUi(config);

  const [value, setValue] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    void submit({ flag: value.trim() });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
      <Input
        value={value}
        onChange={(e) => setValue(e.target.value)}
        spellCheck={false}
        autoComplete="off"
        className="font-mono"
        placeholder={ui.placeholder ?? "flag{...}"}
      />
      <div className="flex items-center gap-3">
        <Button
          type="submit"
          variant="primary"
          disabled={submitting || !value.trim()}
        >
          {submitting ? "提交中…" : "提交"}
        </Button>
      </div>
    </form>
  );
}
