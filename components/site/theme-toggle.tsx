"use client";

/**
 * The theme lives on the document, not in React state: the `.dark` class on
 * <html> is set before first paint and decides which label shows, so server
 * and client render the same markup.
 */
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
      className="text-fg-muted hover:text-fg px-1.5 py-1.5 text-sm transition-colors"
    >
      <span aria-hidden className="dark:hidden">暗色</span>
      <span aria-hidden className="hidden dark:inline">浅色</span>
    </button>
  );
}
