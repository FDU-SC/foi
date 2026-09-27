import { isSettled, type SubmissionState } from "@/lib/backend/types";
import { cn } from "@/lib/utils";

const STAGES = ["排队", "评测", "完成"] as const;

/** How far along the three stages each state sits. */
const REACHED: Record<SubmissionState, number> = {
  queued: 0,
  judging: 1,
  completed: 2,
  disrupted: 2,
};

/**
 * Shows the submission's current stage. The remaining duration is unknown, so
 * the current stage is named rather than shown as a percentage.
 */
export function JudgeProgress({
  state,
  status,
}: {
  state: SubmissionState;
  status?: string | null;
}) {
  const reached = REACHED[state];
  const settled = isSettled(state);
  const failed = state === "disrupted";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center gap-1.5">
        {STAGES.map((label, index) => {
          const done = index < reached || (settled && index <= reached);
          const current = index === reached && !settled;

          return (
            <div key={label} className="flex-1 space-y-1">
              <div
                className={cn(
                  "h-0.5",
                  failed && index === reached
                    ? "bg-warn"
                    : done
                      ? "bg-fg"
                      : current
                        ? "bg-fg-subtle"
                        : "bg-border",
                )}
              />
              <div
                className={cn(
                  "text-[11px]",
                  current ? "text-fg font-medium" : done ? "text-fg-muted" : "text-fg-subtle",
                )}
              >
                {label}
              </div>
            </div>
          );
        })}
      </div>

      {status && !settled ? (
        <p className="text-fg-subtle font-mono text-[11px]">{status}</p>
      ) : null}
    </div>
  );
}
