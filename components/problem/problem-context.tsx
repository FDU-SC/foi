"use client";

import { createContext, use, type ReactNode } from "react";
import type { PublicProblemConfig } from "@/lib/problems/types";

export interface ProblemContextValue {
  config: PublicProblemConfig;
  /** Null when the problem is being viewed outside of any contest. */
  contestId: string | null;
  canSubmit: boolean;
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

/**
 * Lets globally registered statement components (and any custom component a
 * problem author writes) know which problem they are rendering inside,
 * without every statement having to thread props through MDX.
 */
export function useProblem(): ProblemContextValue {
  const value = use(ProblemContext);
  if (!value) {
    throw new Error("useProblem 必须在 ProblemProvider 内部使用");
  }
  return value;
}
