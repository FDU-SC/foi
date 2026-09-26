import Link from "next/link";
import type { ReactNode } from "react";
import { profileHref } from "@/lib/accounts/profile";
import { cn } from "@/lib/utils";

/** A name that opens its owner's profile, or plain text when the username is unknown. */
export function ProfileLink({
  username,
  className,
  children,
}: {
  username?: string;
  className?: string;
  children: ReactNode;
}) {
  if (!username) return <span className={className}>{children}</span>;
  return (
    <Link
      href={profileHref(username)}
      className={cn("hover:text-primary transition-colors", className)}
    >
      {children}
    </Link>
  );
}
