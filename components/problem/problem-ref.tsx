import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { problemHref } from "@/lib/contests/catalogue";
import { problemStatus } from "@/lib/problems/access";

export function ProblemRef({
  contestSlug,
  slug,
  fallbackTitle,
  className,
}: {
  contestSlug: string;
  slug: string;
  fallbackTitle: string;
  className?: string;
}) {
  const status = problemStatus(contestSlug, slug, fallbackTitle);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status.kind === "gone" ? (

        <span className={className}>{status.title}</span>
      ) : (
        <Link
          href={problemHref(contestSlug, slug)}
          className={`hover:text-primary transition-colors ${className ?? ""}`}
        >
          {status.title}
        </Link>
      )}
      {status.kind === "gone" ? <Badge tone="neutral">已删除</Badge> : null}
    </span>
  );
}
