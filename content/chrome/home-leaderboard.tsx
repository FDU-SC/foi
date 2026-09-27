import { getViewer } from "@/auth";
import { ProfileLink } from "@/components/account/profile-link";
import { HomePanel } from "@/components/ui/home-panel";
import { allows } from "@/lib/authz/engine";
import { leaderboardHref } from "@/lib/contests/catalogue";
import { catalogueStandingsFor } from "@/lib/standings/compute";
import { cn } from "@/lib/utils";

/** The top of the catalogue's total board. */
export async function FoiHomeLeaderboard() {
  const viewer = await getViewer();
  if (viewer.uid === null || !allows("leaderboard.read", null, viewer))
    return null;
  const standings = (await catalogueStandingsFor({}, viewer))?.board.standings;
  const rows = standings?.rows.slice(0, 5) ?? [];
  return (
    <HomePanel title="总排行榜" href={leaderboardHref()}>
      {rows.length ? (
        <table className="w-full table-fixed text-sm">
          <thead>
            <tr className="border-border text-fg-muted border-b text-xs">
              <th className="w-8 py-1.5 pl-1.5 text-left font-normal">#</th>
              <th className="py-1.5 text-left font-normal">选手</th>
              <th className="w-16 py-1.5 pr-1.5 text-right font-normal">
                {standings?.totalLabel}
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ rank, total, participant }) => {
              const mine = participant.uid === viewer.uid;
              return (
                <tr
                  key={participant.uid}
                  aria-current={mine || undefined}
                  className={cn("border-border border-b", mine && "bg-mark")}
                >
                  <td className="text-fg-muted py-2 pl-1.5 text-xs tabular-nums">
                    {rank}
                  </td>
                  <td className="py-2 pr-3">
                    <ProfileLink
                      username={participant.username}
                      className={cn("block truncate", mine && "font-semibold")}
                    >
                      {participant.nickname}
                      {mine ? "（我）" : ""}
                    </ProfileLink>
                    {participant.username ? (
                      <span className="text-fg-subtle block truncate text-xs">
                        @{participant.username}
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2 pr-1.5 text-right tabular-nums">
                    {Math.round(total)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      ) : (
        <p className="text-fg-muted py-4 text-sm">还没有提交记录。</p>
      )}
    </HomePanel>
  );
}
