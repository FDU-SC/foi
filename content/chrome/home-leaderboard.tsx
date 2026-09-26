import { getViewer } from "@/auth";
import { ProfileLink } from "@/components/account/profile-link";
import { HomePanel } from "@/components/ui/home-panel";
import { allows } from "@/lib/authz/engine";
import { leaderboardHref } from "@/lib/contests/catalogue";
import { catalogueStandingsFor } from "@/lib/standings/compute";

/** The top of the catalogue's total board. */
export async function FoiHomeLeaderboard() {
  const viewer = await getViewer();
  if (viewer.uid === null || !allows("leaderboard.read", null, viewer))
    return null;
  const standings = (await catalogueStandingsFor({}, viewer))?.board.standings;
  const rows = standings?.rows.slice(0, 5) ?? [];
  return (
    <HomePanel title="总排行榜" href={leaderboardHref()}>
      <ol className="divide-y divide-border">
        {rows.map(({ rank, total, participant }) => (
          <li
            key={participant.uid}
            className={`flex items-center gap-3 px-4 py-3 ${participant.uid === viewer.uid ? "bg-primary-subtle/40" : ""}`}
          >
            <span
              className={`w-4 shrink-0 font-mono text-sm ${rank === 1 ? "text-primary font-semibold" : "text-fg-muted"}`}
            >
              {rank}
            </span>
            <span className="min-w-0 flex-1">
              <ProfileLink
                username={participant.username}
                className="block truncate text-sm font-medium"
              >
                {participant.nickname}
                {participant.uid === viewer.uid ? "（我）" : ""}
              </ProfileLink>
              {participant.username ? (
                <span className="text-fg-subtle block truncate text-xs">
                  @{participant.username}
                </span>
              ) : null}
            </span>
            <span className="text-fg-muted shrink-0 text-xs">
              {standings?.totalLabel}{" "}
              <strong className="text-fg font-mono font-medium">
                {Math.round(total)}
              </strong>
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
