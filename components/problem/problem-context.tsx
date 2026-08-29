"use client";

import { createContext, use, type ReactNode } from "react";
import type { PublicProblemConfig } from "@/lib/problems/types";

export interface ProblemContextValue {
  config: PublicProblemConfig;

  contestSlug: string | null;

  canAct: boolean;

  /**
   * Why not, when `canAct` is false. It is the refusal the submit endpoint
   * would give, so the panel never has to guess at a reason.
   */
  blocked: { code: string; message: string } | null;
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
