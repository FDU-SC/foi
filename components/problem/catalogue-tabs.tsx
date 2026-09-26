import { Tabs } from "@/components/ui/tabs";

/**
 * Views of one sidebar selection. Sit under the list title in the right
 * column — a child of that selection, not a peer of the sidebar. Without a
 * leaderboard the viewer may open, only one view remains and no tabs appear.
 */
export function CatalogueTabs({
  current,
  problems,
  leaderboard,
}: {
  current: "problems" | "leaderboard";
  problems: string;
  leaderboard?: string;
}) {
  if (!leaderboard) return null;
  return (
    <Tabs
      label="视图"
      tabs={[
        { key: "problems", label: "题目", href: problems, current: current === "problems" },
        { key: "leaderboard", label: "排行榜", href: leaderboard, current: current === "leaderboard" },
      ]}
    />
  );
}
