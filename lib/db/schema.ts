import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";
import type {
  Artifact,
  CellStatus,
  HarnessId,
  ModelConfig,
  RunStatus,
  TokenUsage,
} from "@/lib/benchmarks/types";

export const benchmarkRuns = sqliteTable("benchmark_runs", {
  id: text("id").primaryKey(),
  status: text("status").$type<RunStatus>().notNull(),
  suiteIds: text("suite_ids", { mode: "json" }).$type<string[]>().notNull(),
  harnesses: text("harnesses", { mode: "json" }).$type<HarnessId[]>().notNull(),
  taskLimit: integer("task_limit").notNull(),
  maxConcurrency: integer("max_concurrency").notNull(),
  cellCount: integer("cell_count").notNull(),
  completedCellCount: integer("completed_cell_count").notNull().default(0),
  failedCellCount: integer("failed_cell_count").notNull().default(0),
  summary: text("summary", { mode: "json" }).$type<Record<string, unknown>>(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const benchmarkCells = sqliteTable("benchmark_cells", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => benchmarkRuns.id, { onDelete: "cascade" }),
  suiteId: text("suite_id").notNull(),
  suiteName: text("suite_name").notNull(),
  taskId: text("task_id").notNull(),
  taskTitle: text("task_title").notNull(),
  harnessId: text("harness_id").$type<HarnessId>().notNull(),
  modelId: text("model_id").notNull(),
  modelName: text("model_name").notNull(),
  modelProvider: text("model_provider"),
  modelConfig: text("model_config", { mode: "json" })
    .$type<ModelConfig>()
    .notNull(),
  status: text("status").$type<CellStatus>().notNull(),
  sandboxId: text("sandbox_id"),
  commandId: text("command_id"),
  score: real("score"),
  passed: integer("passed", { mode: "boolean" }),
  durationMs: integer("duration_ms"),
  tokenUsage: text("token_usage", { mode: "json" }).$type<TokenUsage>(),
  costEstimate: real("cost_estimate"),
  logs: text("logs"),
  artifacts: text("artifacts", { mode: "json" }).$type<Artifact[]>().notNull(),
  rawHarnessResult: text("raw_harness_result", { mode: "json" }),
  error: text("error"),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
  updatedAt: integer("updated_at", { mode: "timestamp" }).notNull(),
  completedAt: integer("completed_at", { mode: "timestamp" }),
});

export const benchmarkEvents = sqliteTable("benchmark_events", {
  id: text("id").primaryKey(),
  runId: text("run_id")
    .notNull()
    .references(() => benchmarkRuns.id, { onDelete: "cascade" }),
  cellId: text("cell_id").references(() => benchmarkCells.id, {
    onDelete: "cascade",
  }),
  type: text("type").notNull(),
  message: text("message").notNull(),
  payload: text("payload", { mode: "json" }),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export const leaderboardSnapshots = sqliteTable("leaderboard_snapshots", {
  id: text("id").primaryKey(),
  suiteId: text("suite_id").notNull(),
  payload: text("payload", { mode: "json" })
    .$type<Record<string, unknown>>()
    .notNull(),
  createdAt: integer("created_at", { mode: "timestamp" }).notNull(),
});

export type BenchmarkRunRow = typeof benchmarkRuns.$inferSelect;
export type BenchmarkCellRow = typeof benchmarkCells.$inferSelect;
export type BenchmarkEventRow = typeof benchmarkEvents.$inferSelect;
