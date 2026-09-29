"use client";

import { cpp } from "@codemirror/lang-cpp";
import { go } from "@codemirror/lang-go";
import { java } from "@codemirror/lang-java";
import { javascript } from "@codemirror/lang-javascript";
import { python } from "@codemirror/lang-python";
import { rust } from "@codemirror/lang-rust";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import CodeMirror from "@uiw/react-codemirror";
import { useMemo } from "react";
import { cn } from "@/lib/utils";
import type { CodeEditorProps } from "./code-editor";

const LANGUAGES: Record<string, () => Extension> = {
  c: cpp,
  cpp,
  python,
  java,
  rust,
  go,
  javascript,
};

/** Only the site's colour variables, so the light and dark themes both apply as they are. */
const chrome = EditorView.theme({
  "&": { color: "var(--fg)", backgroundColor: "transparent", fontSize: "13px" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": {
    fontFamily: "var(--font-mono)",
    lineHeight: "1.625",
  },
  ".cm-content": { caretColor: "var(--fg)" },
  ".cm-cursor, .cm-dropCursor": { borderLeftColor: "var(--fg)" },
  ".cm-gutters": { backgroundColor: "transparent", color: "var(--fg-subtle)", border: "none" },
  ".cm-activeLine": { backgroundColor: "var(--surface-2)" },
  ".cm-activeLineGutter": { backgroundColor: "transparent", color: "var(--fg-muted)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground, .cm-selectionBackground, .cm-content ::selection":
    { backgroundColor: "color-mix(in oklch, var(--fg) 16%, transparent)" },
  ".cm-matchingBracket, &.cm-focused .cm-matchingBracket": {
    backgroundColor: "var(--surface-3)",
    outline: "none",
  },
  ".cm-placeholder": { color: "var(--fg-subtle)" },
});

/** The statement code blocks' palette, so a snippet looks the same in both. */
const highlight = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--code-keyword)" },
  { tag: [tags.string, tags.character], color: "var(--code-string)" },
  { tag: tags.comment, color: "var(--code-comment)", fontStyle: "italic" },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: "var(--code-number)" },
  {
    tag: [tags.function(tags.variableName), tags.function(tags.propertyName)],
    color: "var(--code-function)",
  },
  { tag: [tags.typeName, tags.className], color: "var(--code-type)" },
  { tag: [tags.processingInstruction, tags.meta], color: "var(--code-keyword)" },
]);

export default function CodeMirrorEditor({
  value,
  onChange,
  language,
  readOnly = false,
  placeholder,
  label,
  minHeight,
}: Omit<CodeEditorProps, "fallback">) {
  const extensions = useMemo(() => {
    const mode = LANGUAGES[language];
    return [
      ...(mode ? [mode()] : []),
      syntaxHighlighting(highlight),
      EditorView.contentAttributes.of({ "aria-label": label }),
    ];
  }, [language, label]);

  return (
    <div
      className={cn(
        "overflow-hidden",
        !readOnly &&
          "border-border bg-surface hover:border-border-strong focus-within:border-fg has-[:focus-visible]:outline-fg rounded-sm border transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2",
      )}
    >
      <CodeMirror
        value={value}
        onChange={onChange}
        extensions={extensions}
        theme={chrome}
        editable={!readOnly}
        readOnly={readOnly}
        placeholder={placeholder}
        minHeight={minHeight}
        basicSetup={{
          foldGutter: false,
          autocompletion: false,
          highlightActiveLine: !readOnly,
          highlightActiveLineGutter: !readOnly,
        }}
      />
    </div>
  );
}
