function trustedProxyHops(): number {
  const raw = process.env.FOI_TRUSTED_PROXY_HOPS;
  if (raw === undefined || raw === "") return 1;

  const hops = Number(raw);
  return Number.isInteger(hops) && hops >= 0 ? hops : 1;
}

const UNRESOLVED_SOURCES = ["direct", "unknown"] as const;

export function isResolvedSource(source: string): boolean {
  return !(UNRESOLVED_SOURCES as readonly string[]).includes(source);
}

export function sourceFrom(store: Headers): string {
  const hops = trustedProxyHops();

  if (hops === 0) return "direct";

  const chain = (store.get("x-forwarded-for") ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (chain.length >= hops) return chain[chain.length - hops];

  return store.get("x-real-ip")?.trim() || "unknown";
}
