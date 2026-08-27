import { capabilitiesOf } from "./groups";
import type { Capability } from "./policy";

export interface SessionUser {
  uid: number;
  username: string;
  nickname: string;
  groups: string[];
}

export interface Viewer {

  readonly uid: number | null;

  readonly groups: readonly string[];

  can(capability: Capability): boolean;
}

export function viewerFor(
  user: { uid: number; groups: readonly string[] } | null | undefined,
): Viewer {
  const groups = user?.groups ?? [];

  const granted = capabilitiesOf(groups);
  return {
    uid: user?.uid ?? null,
    groups,
    can: (capability) => granted.has(capability),
  };
}
