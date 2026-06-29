import type { HarnessId, LeaderboardRow } from "@/lib/benchmarks/types";
import { formatPercent } from "@/lib/utils";

type Props = {
  rows: LeaderboardRow[];
  harnesses: HarnessId[];
  suiteIds: string[];
};

export function HarnessHeatmap({ rows, harnesses, suiteIds }: Props) {
  return (
    <div className="overflow-x-auto">
      <div
        className="grid min-w-[720px] gap-2"
        style={{
          gridTemplateColumns: `minmax(180px, 1.2fr) repeat(${harnesses.length}, minmax(112px, 1fr))`,
        }}
      >
        <div className="text-xs font-medium uppercase text-zinc-500">Suite</div>
        {harnesses.map((harness) => (
          <div
            key={harness}
            className="text-xs font-medium uppercase text-zinc-500"
          >
            {harness}
          </div>
        ))}
        {suiteIds.map((suiteId) => (
          <HeatmapRow
            key={suiteId}
            suiteId={suiteId}
            harnesses={harnesses}
            rows={rows}
          />
        ))}
      </div>
    </div>
  );
}

function HeatmapRow({
  suiteId,
  harnesses,
  rows,
}: {
  suiteId: string;
  harnesses: HarnessId[];
  rows: LeaderboardRow[];
}) {
  const suiteName =
    rows.find((row) => row.suiteId === suiteId)?.suiteName ?? suiteId;

  return (
    <>
      <div className="flex h-12 items-center rounded-md border border-zinc-200 px-3 text-sm font-medium dark:border-zinc-800">
        {suiteName}
      </div>
      {harnesses.map((harness) => {
        const harnessRows = rows.filter(
          (row) => row.suiteId === suiteId && row.harnessId === harness,
        );
        const score =
          harnessRows.length > 0
            ? harnessRows.reduce(
                (total, row) => total + (row.averageScore ?? 0),
                0,
              ) / harnessRows.length
            : null;
        const background = heatColor(score);

        return (
          <div
            key={`${suiteId}-${harness}`}
            className="flex h-12 items-center justify-between rounded-md border border-zinc-200 px-3 text-sm dark:border-zinc-800"
            style={{ background }}
          >
            <span className="font-medium tabular-nums">
              {formatPercent(score)}
            </span>
            <span className="text-xs text-zinc-500">{harnessRows.length}</span>
          </div>
        );
      })}
    </>
  );
}

function heatColor(score: number | null) {
  if (score === null) {
    return "transparent";
  }

  if (score >= 85) {
    return "rgba(16, 185, 129, 0.18)";
  }
  if (score >= 70) {
    return "rgba(8, 145, 178, 0.16)";
  }
  if (score >= 50) {
    return "rgba(245, 158, 11, 0.16)";
  }
  return "rgba(244, 63, 94, 0.14)";
}
