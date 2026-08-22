export type UserRole = "admin" | "user";

export interface SessionUser {
  id: string;
  handle: string;
  displayName: string;
  role: UserRole;
}

export function isAdmin(user: SessionUser | null): boolean {
  return user?.role === "admin";
}
