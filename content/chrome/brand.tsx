import Link from "next/link";
import { site } from "@/lib/site";

export function FoiBrand() {
  return (
    <Link
      href="/"
      className="text-fg inline-flex items-center gap-2 font-bold tracking-tight"
    >
      <span className="foi-mark" aria-hidden>
        <svg viewBox="0 0 16 16" className="size-3.5" fill="none">
          <path
            d="M4 11.5 8 3.5l4 8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <path
            d="M5.6 8.6h4.8"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
          />
        </svg>
      </span>
      {site.name}
    </Link>
  );
}
