/**
 * How the kernel shows a value it has promised not to understand.
 *
 * Pretty-printed and nothing else. This is not a placeholder waiting for a
 * nicer default — it is the honest rendering of an opaque field, and a
 * deployment that wants a test table or a syntax-highlighted source view says
 * so through `Presentation` rather than by teaching the kernel one more shape.
 */
export function JsonDump({
  value,
  className,
}: {
  value: unknown;
  className?: string;
}) {
  return (
    <pre
      className={
        className ??
        "border-border bg-surface-2 text-fg-muted max-h-96 overflow-auto rounded border px-3 py-2 font-mono text-xs whitespace-pre-wrap"
      }
    >
      {typeof value === "string" ? value : JSON.stringify(value, null, 2)}
    </pre>
  );
}
