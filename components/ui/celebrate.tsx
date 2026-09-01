"use client";

import { motion, useReducedMotion } from "motion/react";

const COUNT = 16;
const DURATION = 0.7;

/**
 * Deterministic stand-in for randomness.
 *
 * The scatter has to be irregular enough not to read as a clock face, but
 * `Math.random()` during render is neither pure nor stable between the server
 * and the client. Hashing the index gives the same irregularity every time.
 */
function hash(index: number, salt: number): number {
  const value = Math.sin(index * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

/** Fixed for the lifetime of the module: every burst is the same burst. */
const BITS = Array.from({ length: COUNT }, (_, index) => {
  const angle = (index / COUNT) * Math.PI * 2 + hash(index, 1) * 0.5;
  const distance = 24 + hash(index, 2) * 28;
  return {
    x: Math.cos(angle) * distance,
    y: Math.sin(angle) * distance,
    size: 3 + hash(index, 3) * 3,
    delay: hash(index, 4) * 0.06,
  };
});

/**
 * A one-shot burst of particles, centred on whatever it is placed inside.
 *
 * Plays on mount and never again, so the caller keys it to the event worth
 * marking. It says nothing about *why* it is celebrating — the caller decides
 * that from the verdict's tone, which is the content's word on the matter.
 *
 * Purely decorative, and skipped outright for a reader who asked for less
 * motion: a burst of moving confetti is exactly what that preference is about.
 */
export function Celebrate({ className }: { className?: string }) {
  const reduced = useReducedMotion();
  if (reduced) return null;

  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute inset-0 grid place-items-center ${className ?? ""}`}
    >
      {BITS.map((bit, index) => (
        <motion.span
          key={index}
          className="bg-ok col-start-1 row-start-1 block rounded-full"
          style={{ width: bit.size, height: bit.size }}
          initial={{ x: 0, y: 0, scale: 0, opacity: 1 }}
          animate={{
            x: bit.x,
            y: bit.y,
            scale: [0, 1, 0.3],
            opacity: [1, 1, 0],
          }}
          transition={{
            duration: DURATION,
            delay: bit.delay,
            ease: [0.16, 1, 0.3, 1],
          }}
        />
      ))}
    </span>
  );
}
