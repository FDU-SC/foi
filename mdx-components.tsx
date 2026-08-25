import type { MDXComponents } from "mdx/types";
import type { ComponentPropsWithoutRef } from "react";
import { presentation } from "@/lib/presentation/registry";
import { cn } from "@/lib/utils";

type Props<T extends keyof React.JSX.IntrinsicElements> =
  ComponentPropsWithoutRef<T>;

/**
 * Global MDX mapping. Every statement in `content/problems` renders through
 * this, which is what keeps them visually consistent without each author
 * having to think about styling.
 *
 * Two halves, and the split is the point. Below is how a heading, a table and
 * a code fence look, which is the design system and therefore the kernel's.
 * `Callout`, `Sample`, a submitter — the things a statement *writes* — are a
 * deployment's, and arrive through `presentation.mdxComponents`. They used to
 * be imported here by name, which made a statement vocabulary invented for one
 * competition part of the platform, and made `content/` undeletable.
 *
 * The file has to stay at the repository root: Next resolves
 * `useMDXComponents` from exactly here.
 */
const elements: MDXComponents = {
  h1: ({ className, ...props }: Props<"h1">) => (
    <h1
      className={cn(
        "text-fg mt-8 mb-4 scroll-mt-20 text-2xl font-bold tracking-tight first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: Props<"h2">) => (
    <h2
      className={cn(
        "text-fg border-border mt-8 mb-3 scroll-mt-20 border-b pb-1.5 text-lg font-semibold",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: Props<"h3">) => (
    <h3
      className={cn(
        "text-fg mt-6 mb-2 scroll-mt-20 text-base font-semibold",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: Props<"h4">) => (
    <h4
      className={cn("text-fg mt-4 mb-2 scroll-mt-20 text-sm font-semibold", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: Props<"p">) => (
    <p className={cn("text-fg my-3 leading-7", className)} {...props} />
  ),
  a: ({ className, ...props }: Props<"a">) => (
    <a
      className={cn(
        "text-primary decoration-primary/40 underline underline-offset-2",
        "hover:decoration-primary transition-colors",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }: Props<"ul">) => (
    <ul className={cn("my-3 ml-5 list-disc space-y-1.5", className)} {...props} />
  ),
  ol: ({ className, ...props }: Props<"ol">) => (
    <ol
      className={cn("my-3 ml-5 list-decimal space-y-1.5", className)}
      {...props}
    />
  ),
  li: ({ className, ...props }: Props<"li">) => (
    <li className={cn("text-fg leading-7", className)} {...props} />
  ),
  blockquote: ({ className, ...props }: Props<"blockquote">) => (
    <blockquote
      className={cn(
        "border-border-strong text-fg-muted my-4 border-l-2 pl-4 italic",
        className,
      )}
      {...props}
    />
  ),
  hr: ({ className, ...props }: Props<"hr">) => (
    <hr className={cn("border-border my-8", className)} {...props} />
  ),
  strong: ({ className, ...props }: Props<"strong">) => (
    <strong className={cn("text-fg font-semibold", className)} {...props} />
  ),
  table: ({ className, ...props }: Props<"table">) => (
    <div className="border-border my-4 overflow-x-auto rounded-lg border">
      <table className={cn("w-full text-sm", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }: Props<"thead">) => (
    <thead className={cn("bg-surface-2", className)} {...props} />
  ),
  th: ({ className, ...props }: Props<"th">) => (
    <th
      className={cn(
        "text-fg-muted border-border border-b px-3 py-2 text-left text-xs font-semibold",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: Props<"td">) => (
    <td
      className={cn("border-border border-b px-3 py-2 last:border-0", className)}
      {...props}
    />
  ),
  // rehype-pretty-code tags fenced blocks with `data-language`; anything
  // without it is inline code and needs the pill treatment.
  code: ({ className, ...props }: Props<"code">) => {
    const isFenced = "data-language" in props;
    if (isFenced) return <code className={className} {...props} />;
    return (
      <code
        className={cn(
          "bg-surface-3 text-fg rounded px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  pre: ({ className, ...props }: Props<"pre">) => (
    <pre
      className={cn(
        "border-border bg-surface-2 my-4 overflow-hidden rounded-lg border",
        className,
      )}
      {...props}
    />
  ),
};

// Content last, so a deployment that wants its own `pre` can have it. Built
// once at module load rather than per call: both halves are static.
const components: MDXComponents = {
  ...elements,
  ...presentation.mdxComponents,
};

export function useMDXComponents(): MDXComponents {
  return components;
}
