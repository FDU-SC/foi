"use client";

/**
 * Both icons are always in the DOM, stacked in one grid cell, and the `.dark`
 * class on <html> decides which one is turned up. That keeps the crossfade in
 * CSS: the theme lives on the document, not in React state, and the class is
 * already set before first paint so the transition never plays on load.
 */
const ICON =
  "col-start-1 row-start-1 size-4 transition-[transform,opacity] duration-300 ease-out";

export function ThemeToggle() {
  const toggle = () => {
    const next = !document.documentElement.classList.contains("dark");
    document.documentElement.classList.toggle("dark", next);
    localStorage.setItem("foi-theme", next ? "dark" : "light");
  };

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="切换主题"
      className="text-fg-subtle hover:text-fg hover:bg-surface-2 grid size-7 place-items-center rounded-md transition-colors"
    >
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden
        className={`${ICON} rotate-90 scale-0 opacity-0 dark:rotate-0 dark:scale-100 dark:opacity-100`}
      >
        <circle cx="12" cy="12" r="4" />
        <path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
      </svg>
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        aria-hidden
        className={`${ICON} rotate-0 scale-100 opacity-100 dark:-rotate-90 dark:scale-0 dark:opacity-0`}
      >
        <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" />
      </svg>
    </button>
  );
}
