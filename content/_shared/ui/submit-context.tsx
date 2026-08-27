"use client";

import { createContext, useContext } from "react";

export interface SubmitContextValue {
  submit: (payload: unknown) => void;
  submitting: boolean;
}

const SubmitContext = createContext<SubmitContextValue | null>(null);

export const SubmitProvider = SubmitContext.Provider;

export function useSubmitContext(): SubmitContextValue {
  const ctx = useContext(SubmitContext);
  if (!ctx) {
    throw new Error("useSubmitContext must be used inside <SubmitPanel>");
  }
  return ctx;
}
