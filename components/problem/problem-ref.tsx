import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { problemStatus } from "@/lib/problems/access";

export function ProblemRef({
  slug,
  fallbackTitle,
  className,
}: {
  slug: string;
  fallbackTitle: string;
  className?: string;
}) {
  const status = problemStatus(slug, fallbackTitle);

  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {status.kind === "gone" ? (

        <span className={className}>{status.title}</span>
      ) : (
        <Link
          href={`/problems/${slug}`}
          className={`hover:text-primary transition-colors ${className ?? ""}`}
        >
          {status.title}
        </Link>
      )}
      {status.kind === "retired" ? <Badge>已下架</Badge> : null}
      {status.kind === "gone" ? <Badge tone="neutral">已删除</Badge> : null}
    </span>
  );
}
