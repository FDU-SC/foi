import { tier } from "@/lib/boot/deployment";
import type { ProblemBackend } from "./types";

function developmentFallbackUrl(): string | undefined {
  return process.env.FOI_DEV_BACKEND_URL || undefined;
}

export function envFragment(id: string): string {
  return id.replace(/-/g, "_").toUpperCase();
}

export function backendUrl(id: string): string | undefined {

  const configured = process.env[`FOI_BACKEND_${envFragment(id)}_URL`];
  if (configured) return configured;

  return tier() === "dev" ? developmentFallbackUrl() : undefined;
}

export function backendSecret(id: string): string | undefined {
  return process.env[`FOI_BACKEND_${envFragment(id)}_SECRET`] || undefined;
}

export function sharedSecret(): string | undefined {
  return process.env.FOI_BACKEND_SECRET || undefined;
}

export function effectiveSecretFromEnv(id: string): string | undefined {
  return backendSecret(id) || sharedSecret();
}

export function fromEnv(id: string): ProblemBackend {
  return { url: backendUrl(id), secret: backendSecret(id) };
}
