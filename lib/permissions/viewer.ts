import { capabilitiesOf } from "./groups";
import type { Capability } from "./policy";

export interface SessionUser {
  handle: string;
  displayName: string;
  groups: string[];
}

export interface Viewer {

  readonly handle: string | null;

  readonly groups: readonly string[];

  can(capability: Capability): boolean;
}

export function viewerFor(
  user: { handle: string; groups: readonly string[] } | null | undefined,
): Viewer {
  const groups = user?.groups ?? [];

  const granted = capabilitiesOf(groups);
  return {
    handle: user?.handle ?? null,
    groups,
    can: (capability) => granted.has(capability),
  };
}
