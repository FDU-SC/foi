import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { problemStatus } from "@/lib/problems/access";

/**
 * How a submission record refers to the problem it was made against.
 *
 * The two pages that show submissions used to answer this differently: the
 * list joined the mirror table and printed whatever title was last synced, the
 * detail page read the registry and fell back to the bare slug. So one deleted
 * problem appeared under its old title in one place and as a bare slug in the
 * other, and both linked somewhere that 404s.
 *
 * `fallbackTitle` is the snapshot in `problems`, which is all that survives a
 * directory being deleted for real.
 */
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
        // No link: the page is gone, and offering one that 404s is worse than
        // plain text. The title is the last thing the mirror row saw.
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
