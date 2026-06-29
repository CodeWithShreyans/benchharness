"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { LeaderboardRow } from "@/lib/benchmarks/types";

type Props = {
  rows: LeaderboardRow[];
};

export function ScoreChart({ rows }: Props) {
  const data = rows.slice(0, 8).map((row) => ({
    name: `${row.modelId} / ${row.harnessId}`,
    score: row.averageScore ? Number(row.averageScore.toFixed(1)) : 0,
  }));

  return (
    <div className="h-[280px] w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 56, left: 0 }}
        >
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="name"
            angle={-32}
            textAnchor="end"
            interval={0}
            tick={{ fontSize: 11 }}
            height={68}
          />
          <YAxis domain={[0, 100]} tick={{ fontSize: 12 }} />
          <Tooltip
            cursor={{ fill: "rgba(113, 113, 122, 0.12)" }}
            formatter={(value) => [`${value}%`, "Score"]}
          />
          <Bar dataKey="score" fill="#0891b2" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
