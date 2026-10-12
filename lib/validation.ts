import type { z } from "zod";

/** Each issue as `path: message`, the path reading `(root)` when there is none. */
export function issueItems(error: z.ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "(root)"}: ${issue.message}`);
}

/** The issues as an indented list, for a refusal that names the file at fault. */
export function issueList(error: z.ZodError): string {
  return issueItems(error).map((item) => `  - ${item}`).join("\n");
}

export type Parsed<T> = { ok: true; data: T } | { ok: false; error: string };

/** `input` through `schema`, or its first issue as a message a form can show. */
export function parseInput<S extends z.ZodType>(
  schema: S,
  input: unknown,
  fallback = "参数不合法",
): Parsed<z.output<S>> {
  const parsed = schema.safeParse(input);
  return parsed.success
    ? { ok: true, data: parsed.data }
    : { ok: false, error: parsed.error.issues[0]?.message ?? fallback };
}
