"use client";

import { createContext, use, type ReactNode } from "react";
import type { Permission } from "@/lib/authz/adapters";
import type { PublicProblemConfig } from "@/lib/problems/types";

export interface ProblemContextValue {
  config: PublicProblemConfig;

  /** The contest this problem is being worked on as part of. */
  contestSlug: string;

  /** Render-time preflight; execution always authorizes again. */
  permissions: {
    submit: Permission;
    actions: Partial<Record<string, Permission>>;
  };
}

const ProblemContext = createContext<ProblemContextValue | null>(null);

export function ProblemProvider({
  value,
  children,
}: {
  value: ProblemContextValue;
  children: ReactNode;
}) {
  return <ProblemContext value={value}>{children}</ProblemContext>;
}

export function useProblem(): ProblemContextValue {
  const value = use(ProblemContext);
  if (!value) {
    throw new Error("useProblem 必须在 ProblemProvider 内部使用");
  }
  return value;
}
