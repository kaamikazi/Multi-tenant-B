import { TIER_LABEL, type ScoreFactor, type Tier } from "@/lib/leads";

const TIER_STYLE: Record<Tier, string> = {
  hot: "bg-danger/15 text-danger",
  warm: "bg-amber-500/15 text-amber-700 dark:text-amber-300",
  cold: "bg-sky-500/15 text-sky-700 dark:text-sky-300",
};

export function ScoreBadge({ score, tier }: { score: number; tier: Tier }) {
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-xs font-medium ${TIER_STYLE[tier]}`}>
      <span className="tabular-nums">{score}</span>
      <span aria-hidden>·</span>
      {TIER_LABEL[tier]}
    </span>
  );
}

/** Every factor, its points out of its maximum, and the reason. */
export function ScoreBreakdown({ breakdown }: { breakdown: ScoreFactor[] }) {
  return (
    <ul className="grid gap-4">
      {breakdown.map((f) => (
        <li key={f.factor}>
          <div className="flex items-baseline justify-between gap-3 text-sm">
            <span className="font-medium">{f.factor}</span>
            <span className="tabular-nums text-muted">
              {f.points} / {f.max}
            </span>
          </div>
          <div
            className="mt-1.5 h-2 overflow-hidden rounded-full bg-background"
            role="meter"
            aria-label={`${f.factor}: ${f.points} of ${f.max} points`}
            aria-valuenow={f.points}
            aria-valuemin={0}
            aria-valuemax={f.max}
          >
            <div className="h-full rounded-full bg-accent" style={{ width: `${(f.points / f.max) * 100}%` }} />
          </div>
          <p className="mt-1 text-xs text-muted">{f.reason}</p>
        </li>
      ))}
    </ul>
  );
}
