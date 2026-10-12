import type { MDXComponents } from "mdx/types";
import type { ComponentPropsWithoutRef } from "react";
import { cn } from "@/lib/utils";

type Props<T extends keyof React.JSX.IntrinsicElements> =
  ComponentPropsWithoutRef<T>;

/**
 * Statements read as a printed sheet: prose in the serif stack, whose Latin
 * face is the one KaTeX sets formulas in; headings in the interface face.
 */
const elements: MDXComponents = {
  h1: ({ className, ...props }: Props<"h1">) => (
    <h1
      className={cn(
        "text-fg mt-8 mb-3 scroll-mt-20 text-xl font-bold first:mt-0",
        className,
      )}
      {...props}
    />
  ),
  h2: ({ className, ...props }: Props<"h2">) => (
    <h2
      className={cn(
        "text-fg mt-7 mb-2 scroll-mt-20 text-base font-bold",
        className,
      )}
      {...props}
    />
  ),
  h3: ({ className, ...props }: Props<"h3">) => (
    <h3
      className={cn(
        "text-fg mt-5 mb-1.5 scroll-mt-20 text-[15px] font-semibold",
        className,
      )}
      {...props}
    />
  ),
  h4: ({ className, ...props }: Props<"h4">) => (
    <h4
      className={cn("text-fg mt-4 mb-1.5 scroll-mt-20 text-sm font-semibold", className)}
      {...props}
    />
  ),
  p: ({ className, ...props }: Props<"p">) => (
    <p className={cn("text-fg my-2.5 font-serif text-base leading-[1.85]", className)} {...props} />
  ),
  a: ({ className, ...props }: Props<"a">) => (
    <a
      className={cn(
        "text-fg decoration-border-strong underline underline-offset-2",
        "hover:decoration-fg transition-colors",
        className,
      )}
      {...props}
    />
  ),
  ul: ({ className, ...props }: Props<"ul">) => (
    <ul className={cn("my-2.5 ml-5 list-disc space-y-1 font-serif", className)} {...props} />
  ),
  ol: ({ className, ...props }: Props<"ol">) => (
    <ol
      className={cn("my-2.5 ml-5 list-decimal space-y-1 font-serif", className)}
      {...props}
    />
  ),
  li: ({ className, ...props }: Props<"li">) => (
    <li className={cn("text-fg leading-[1.85]", className)} {...props} />
  ),
  blockquote: ({ className, ...props }: Props<"blockquote">) => (
    <blockquote
      className={cn(
        "border-fg text-fg-muted my-4 border-l-2 pl-4 font-serif",
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
    <div className="my-4 overflow-x-auto">
      <table className={cn("w-full font-sans text-sm", className)} {...props} />
    </div>
  ),
  thead: ({ className, ...props }: Props<"thead">) => (
    <thead className={className} {...props} />
  ),
  th: ({ className, ...props }: Props<"th">) => (
    <th
      className={cn(
        "text-fg-muted border-fg border-b px-3 py-1.5 text-left text-xs font-medium first:pl-0",
        className,
      )}
      {...props}
    />
  ),
  td: ({ className, ...props }: Props<"td">) => (
    <td
      className={cn("border-border border-b px-3 py-1.5 tabular-nums first:pl-0", className)}
      {...props}
    />
  ),

  code: ({ className, ...props }: Props<"code">) => {
    const isFenced = "data-language" in props;
    if (isFenced) return <code className={className} {...props} />;
    return (
      <code
        className={cn(
          "bg-surface-2 text-fg rounded-sm px-1 py-0.5 font-mono text-[0.85em]",
          className,
        )}
        {...props}
      />
    );
  },
  pre: ({ className, ...props }: Props<"pre">) => (
    <pre
      className={cn(
        "border-border bg-surface-2 my-4 overflow-hidden border",
        className,
      )}
      {...props}
    />
  ),
};

export function useMDXComponents(): MDXComponents {
  return elements;
}
