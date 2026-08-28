const DAY_MS = 24 * 60 * 60 * 1000;

export const USERNAME_CHANGE_COOLDOWN_DAYS = 30;

/** null means the cooldown has never started — the next change is free. */
export function usernameChangeAvailableAt(changedAt: Date | null): Date | null {
  if (!changedAt) return null;
  return new Date(changedAt.getTime() + USERNAME_CHANGE_COOLDOWN_DAYS * DAY_MS);
}

export function usernameChangeAllowed(
  changedAt: Date | null,
  now: Date = new Date(),
): boolean {
  const availableAt = usernameChangeAvailableAt(changedAt);
  return availableAt === null || availableAt.getTime() <= now.getTime();
}
