import type { ReactNode } from "react";

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className="text-fg-subtle size-4 shrink-0"
    >
      {children}
    </svg>
  );
}

export function SolvedIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="6.25" />
      <path d="m5.5 8.25 1.75 1.75 3.25-3.5" />
    </Icon>
  );
}

export function TrophyIcon() {
  return (
    <Icon>
      <path d="M5 2.75h6v3.5a3 3 0 0 1-6 0z" />
      <path d="M5 4H3.25a1.75 1.75 0 0 0 1.9 2.5M11 4h1.75a1.75 1.75 0 0 1-1.9 2.5M8 9.25v2.5M5.75 13.25h4.5" />
    </Icon>
  );
}

export function ClockIcon() {
  return (
    <Icon>
      <circle cx="8" cy="8" r="6.25" />
      <path d="M8 4.75V8l2 1.5" />
    </Icon>
  );
}

export function CalendarIcon() {
  return (
    <Icon>
      <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="1.5" />
      <path d="M2.25 6.5h11.5M5.5 1.75v3M10.5 1.75v3" />
    </Icon>
  );
}
