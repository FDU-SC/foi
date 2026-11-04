import type { ProblemBackend } from "./types";

export function envFragment(id: string): string {
  return id.replace(/-/g, "_").toUpperCase();
}

export function backendUrl(id: string): string | undefined {
  return process.env[`FOI_BACKEND_${envFragment(id)}_URL`] || undefined;
}

/** Every backend key and runner token derives from it. */
export function masterSecret(): string | undefined {
  return process.env.FOI_BACKEND_SECRET || undefined;
}

export function fromEnv(id: string): ProblemBackend {
  return { url: backendUrl(id) };
}
