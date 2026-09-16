import { getViewer } from "@/auth";
import { allows } from "@/lib/authz/engine";
import { leaderboardRows } from "./leaderboard-data";
import { HomePanel } from "@/components/ui/home-panel";

export async function FoiHomeLeaderboard() {
  const viewer = await getViewer();
  if (viewer.uid === null || !allows("leaderboard.read", null, viewer))
    return null;
  const rows = await leaderboardRows(5);
  return (
    <HomePanel title="练习排行榜" href="/leaderboard">
      <ol className="divide-y divide-border">
        {rows.map((row, i) => (
          <li
            key={row.uid}
            className={`flex items-center gap-3 px-4 py-3 ${row.uid === viewer.uid ? "bg-primary-subtle/40" : ""}`}
          >
            <span
              className={`w-4 shrink-0 font-mono text-sm ${i === 0 ? "text-primary font-semibold" : "text-fg-muted"}`}
            >
              {i + 1}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {row.nickname}
                {row.uid === viewer.uid ? "（我）" : ""}
              </span>
              <span className="text-fg-subtle block truncate text-xs">
                @{row.username}
              </span>
            </span>
            <span className="text-fg-muted shrink-0 text-xs">
              <strong className="text-fg font-mono font-medium">
                {row.solved}
              </strong>{" "}
              题
            </span>
          </li>
        ))}
      </ol>
      {!rows.length && (
        <p className="text-fg-muted p-4 text-sm">还没有提交记录。</p>
      )}
    </HomePanel>
  );
}
