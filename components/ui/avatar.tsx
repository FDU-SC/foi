import type { CSSProperties } from "react";
import { identiconHue, identiconInitial } from "@/lib/accounts/avatar";
import { cn } from "@/lib/utils";

/**
 * Enough of an account to draw it. Structural on purpose: `Participant`,
 * `SessionUser` and `ResolvedUser` all satisfy it without a mapping step.
 */
export interface AvatarSubject {
  uid: number;
  nickname: string;
  avatarUpdatedAt?: Date | null;
}

const SIZES = {
  sm: { box: "size-6 text-xs", px: 24 },
  md: { box: "size-10 text-base", px: 40 },
  lg: { box: "size-24 text-3xl", px: 96 },
} as const;

export type AvatarSize = keyof typeof SIZES;

/**
 * Where an uploaded avatar lives, or null when there is none to ask for.
 * The timestamp is what makes the response safe to cache immutably.
 */
export function avatarSrc(subject: AvatarSubject): string | null {
  const at = subject.avatarUpdatedAt;
  return at ? `/api/avatars/${subject.uid}?v=${at.getTime()}` : null;
}

export interface AvatarProps {
  of: AvatarSubject;
  size?: AvatarSize;
  className?: string;
}

/**
 * Decorative in every position it holds: the nickname is always beside it, and
 * announcing the picture too would read the same person out twice.
 */
export function Avatar({ of, size = "sm", className }: AvatarProps) {
  const { box, px } = SIZES[size];
  const shape = cn("shrink-0 rounded-full", box, className);

  const src = avatarSrc(of);
  if (src) {
    return (
      <img
        src={src}
        alt=""
        aria-hidden
        width={px}
        height={px}
        loading="lazy"
        decoding="async"
        className={cn(shape, "bg-surface-2 object-cover")}
      />
    );
  }

  return (
    <span
      aria-hidden
      style={{ "--avatar-hue": String(identiconHue(of.uid)) } as CSSProperties}
      className={cn(
        shape,
        "flex items-center justify-center font-semibold select-none",
        "bg-[oklch(94%_0.045_var(--avatar-hue))] text-[oklch(50%_0.16_var(--avatar-hue))]",
        "dark:bg-[oklch(30%_0.06_var(--avatar-hue))] dark:text-[oklch(74%_0.15_var(--avatar-hue))]",
      )}
    >
      {identiconInitial(of.nickname)}
    </span>
  );
}
