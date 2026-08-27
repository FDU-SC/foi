"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Select, Textarea } from "@/components/ui/field";
import { useProblem } from "@/components/problem/problem-context";
import { problemUi } from "./ui-config";
import { useSubmitContext } from "./submit-context";

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

export function CodeInput() {
  const { config } = useProblem();
  const { submit, submitting } = useSubmitContext();
  const ui = problemUi(config);

  const languages = ui.languages ?? DEFAULT_LANGUAGES;
  const [language, setLanguage] = useState(languages[0] ?? "cpp");
  const [value, setValue] = useState("");

  const onSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    void submit({ language, source: value });
  };

  return (
    <form onSubmit={onSubmit} className="space-y-3">
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
