"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

export function ContestCountdown({
  target,
  initialNow,
  refreshAt,
}: {
  target: number;
  initialNow: number;
  refreshAt?: number;
}) {
  const [now, setNow] = useState(initialNow);
  const router = useRouter();
  useEffect(() => {
    const timer = setInterval(() => {
      const current = Date.now();
      setNow(current);
      if (current > (refreshAt ?? target)) {
        clearInterval(timer);
        router.refresh();
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [target, refreshAt, router]);
  const seconds = Math.max(0, Math.ceil((target - now) / 1000));
  const days = Math.floor(seconds / 86400);
  const clock = [
    Math.floor(seconds / 3600) % 24,
    Math.floor(seconds / 60) % 60,
    seconds % 60,
  ]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
  return (
    <span className="font-mono text-2xl font-semibold tabular-nums">
      {days > 0 ? `${days} 天 ` : ""}
      {clock}
    </span>
  );
}
