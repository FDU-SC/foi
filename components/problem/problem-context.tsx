"use client";

import { createContext, use, type ReactNode } from "react";
import type { PublicProblemConfig } from "@/lib/problems/types";

export interface ProblemContextValue {
  config: PublicProblemConfig;
  /** Null when the problem is being viewed outside of any contest. */
  contestSlug: string | null;
  /**
   * Whether this person may act on the problem at all: signed in, and looking
   * at a problem that is actually open to them.
   *
   * Covers submitting and the interactive endpoints alike, because the answer
   * is the same for both and for the same reason — a preview holder reads an
   * unopened statement without being allowed to put load on its backend,
   * whether that load is a verdict to compute or a container to start. Named
   * for the general case so that a component asking whether it may spawn does
   * not have to read a field called `canSubmit` and hope.
   */
  canAct: boolean;
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
