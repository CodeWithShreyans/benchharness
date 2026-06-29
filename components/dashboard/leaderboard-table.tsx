import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { LeaderboardRow } from "@/lib/benchmarks/types";
import { formatDuration, formatPercent } from "@/lib/utils";

type Props = {
  rows: LeaderboardRow[];
};

export function LeaderboardTable({ rows }: Props) {
  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead>Model</TableHead>
          <TableHead>Harness</TableHead>
          <TableHead>Suite</TableHead>
          <TableHead className="text-right">Score</TableHead>
          <TableHead className="text-right">Pass Rate</TableHead>
          <TableHead className="text-right">Cells</TableHead>
          <TableHead className="text-right">Avg Runtime</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((row) => (
          <TableRow key={`${row.suiteId}-${row.harnessId}-${row.modelId}`}>
            <TableCell>
              <div className="font-medium">{row.modelId}</div>
              <div className="text-xs text-zinc-500">{row.modelName}</div>
            </TableCell>
            <TableCell>
              <Badge variant="secondary">{row.harnessId}</Badge>
            </TableCell>
            <TableCell>{row.suiteName}</TableCell>
            <TableCell className="text-right font-medium tabular-nums">
              {formatPercent(row.averageScore)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatPercent(row.passRate)}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {row.completedCells + row.failedCells}
            </TableCell>
            <TableCell className="text-right tabular-nums">
              {formatDuration(row.averageDurationMs)}
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  );
}
