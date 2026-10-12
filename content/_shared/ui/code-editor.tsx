"use client";

import { lazy, Suspense, useSyncExternalStore, type ReactNode } from "react";

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  /** A language id such as `cpp` or `python`; an unknown one is shown as plain text. */
  language: string;
  readOnly?: boolean;
  placeholder?: string;
  /** Read aloud for the editing area. */
  label: string;
  minHeight?: string;
  /** Shown on the server and until the editor has loaded. */
  fallback: ReactNode;
}

const Editor = lazy(() => import("./code-mirror"));

const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

/** CodeMirror, fetched only once a page actually shows code. */
export function CodeEditor({ fallback, ...props }: CodeEditorProps) {
  const hydrated = useSyncExternalStore(subscribe, onClient, onServer);
  if (!hydrated) return fallback;

  return (
    <Suspense fallback={fallback}>
      <Editor {...props} />
    </Suspense>
  );
}
