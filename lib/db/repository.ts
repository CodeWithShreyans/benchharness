import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  BenchmarkEventInput,
  CompleteCellInput,
  StartBenchmarkRunInput,
} from "@/lib/api/validation";
import { benchmarkSuites, getBenchmarkTasks } from "@/lib/benchmarks/registry";
import type {
  BenchmarkCellRecord,
  BenchmarkEventRecord,
  BenchmarkRunRecord,
  CellStatus,
  LeaderboardRow,
  ModelConfig,
  NormalizedResult,
} from "@/lib/benchmarks/types";
import { getDb, hasDatabase } from "@/lib/db/client";
import { sampleCells, sampleEvents, sampleRuns } from "@/lib/db/sample-data";
import {
  type BenchmarkCellRow,
  type BenchmarkEventRow,
  type BenchmarkRunRow,
  benchmarkCells,
  benchmarkEvents,
  benchmarkRuns,
} from "@/lib/db/schema";

type MemoryStore = {
  runs: BenchmarkRunRecord[];
  cells: BenchmarkCellRecord[];
  events: BenchmarkEventRecord[];
};

let localMemoryStore: MemoryStore | null = null;

function memoryStore() {
  if (!localMemoryStore) {
    localMemoryStore = {
      runs: [...sampleRuns],
      cells: [...sampleCells],
      events: [...sampleEvents],
    };
  }

  return localMemoryStore;
}

function iso(date: Date | string | null) {
  if (!date) {
    return null;
  }

  return typeof date === "string" ? date : date.toISOString();
}

function runFromRow(row: BenchmarkRunRow): BenchmarkRunRecord {
  return {
    id: row.id,
    status: row.status,
    suiteIds: row.suiteIds,
    harnesses: row.harnesses,
    taskLimit: row.taskLimit,
    maxConcurrency: row.maxConcurrency,
    cellCount: row.cellCount,
    completedCellCount: row.completedCellCount,
    failedCellCount: row.failedCellCount,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
    completedAt: iso(row.completedAt),
  };
}

function cellFromRow(row: BenchmarkCellRow): BenchmarkCellRecord {
  return {
    id: row.id,
    runId: row.runId,
    suiteId: row.suiteId,
    suiteName: row.suiteName,
    taskId: row.taskId,
    taskTitle: row.taskTitle,
    harnessId: row.harnessId,
    modelId: row.modelId,
    modelName: row.modelName,
    modelProvider: row.modelProvider,
    modelConfig: row.modelConfig,
    status: row.status,
    sandboxId: row.sandboxId,
    commandId: row.commandId,
    score: row.score,
    passed: row.passed,
    durationMs: row.durationMs,
    tokenUsage: row.tokenUsage,
    costEstimate: row.costEstimate,
    logs: row.logs,
    artifacts: row.artifacts ?? [],
    error: row.error,
    rawHarnessResult: row.rawHarnessResult,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
    updatedAt: iso(row.updatedAt) ?? new Date().toISOString(),
    completedAt: iso(row.completedAt),
  };
}

function eventFromRow(row: BenchmarkEventRow): BenchmarkEventRecord {
  return {
    id: row.id,
    runId: row.runId,
    cellId: row.cellId,
    type: row.type,
    message: row.message,
    payload: row.payload,
    createdAt: iso(row.createdAt) ?? new Date().toISOString(),
  };
}

function displayNameForModel(model: ModelConfig) {
  return model.displayName ?? model.model;
}

export function buildBenchmarkCells(
  input: StartBenchmarkRunInput,
  runId: string,
) {
  const createdAt = new Date().toISOString();
  const cells: BenchmarkCellRecord[] = [];

  for (const suiteId of input.suiteIds) {
    const suite = benchmarkSuites.find((candidate) => candidate.id === suiteId);
    if (!suite) {
      continue;
    }

    const tasks = getBenchmarkTasks(suiteId, input.taskLimit);
    for (const task of tasks) {
      for (const harnessId of input.harnesses) {
        const models = input.models[harnessId] ?? [];
        for (const model of models) {
          cells.push({
            id: crypto.randomUUID(),
            runId,
            suiteId,
            suiteName: suite.name,
            taskId: task.id,
            taskTitle: task.title,
            harnessId,
            modelId: model.id,
            modelName: displayNameForModel(model),
            modelProvider: model.provider ?? model.providerId ?? null,
            modelConfig: model,
            status: "queued",
            sandboxId: null,
            commandId: null,
            score: null,
            passed: null,
            durationMs: null,
            tokenUsage: null,
            costEstimate: null,
            logs: null,
            artifacts: [],
            error: null,
            rawHarnessResult: null,
            createdAt,
            updatedAt: createdAt,
            completedAt: null,
          });
        }
      }
    }
  }

  return cells;
}

export async function createBenchmarkRun(input: StartBenchmarkRunInput) {
  const runId = crypto.randomUUID();
  const createdAt = new Date();
  const cells = buildBenchmarkCells(input, runId);
  const run: BenchmarkRunRecord = {
    id: runId,
    status: "queued",
    suiteIds: input.suiteIds,
    harnesses: input.harnesses,
    taskLimit: input.taskLimit,
    maxConcurrency: input.maxConcurrency,
    cellCount: cells.length,
    completedCellCount: 0,
    failedCellCount: 0,
    createdAt: createdAt.toISOString(),
    updatedAt: createdAt.toISOString(),
    completedAt: null,
  };

  if (!hasDatabase()) {
    const store = memoryStore();
    store.runs.unshift(run);
    store.cells.unshift(...cells);
    store.events.unshift({
      id: crypto.randomUUID(),
      runId,
      cellId: null,
      type: "run.created",
      message: `Created ${cells.length} benchmark cells.`,
      payload: { cellCount: cells.length },
      createdAt: createdAt.toISOString(),
    });
    return { run, cells };
  }

  const db = getDb();
  await db.insert(benchmarkRuns).values({
    ...run,
    createdAt,
    updatedAt: createdAt,
    completedAt: null,
  });

  if (cells.length > 0) {
    await db.insert(benchmarkCells).values(
      cells.map((cell) => ({
        ...cell,
        createdAt,
        updatedAt: createdAt,
        completedAt: null,
      })),
    );
  }

  await addBenchmarkEvent({
    runId,
    type: "run.created",
    message: `Created ${cells.length} benchmark cells.`,
    payload: { cellCount: cells.length },
  });

  return { run, cells };
}

export async function listRuns() {
  if (!hasDatabase()) {
    return memoryStore().runs;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkRuns)
    .orderBy(desc(benchmarkRuns.createdAt))
    .limit(50);

  return rows.map(runFromRow);
}

export async function getRun(runId: string) {
  if (!hasDatabase()) {
    return memoryStore().runs.find((run) => run.id === runId) ?? null;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkRuns)
    .where(eq(benchmarkRuns.id, runId))
    .limit(1);

  return rows[0] ? runFromRow(rows[0]) : null;
}

export async function listCellsForRun(runId: string) {
  if (!hasDatabase()) {
    return memoryStore().cells.filter((cell) => cell.runId === runId);
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkCells)
    .where(eq(benchmarkCells.runId, runId))
    .orderBy(desc(benchmarkCells.createdAt));

  return rows.map(cellFromRow);
}

export async function listEventsForRun(runId: string) {
  if (!hasDatabase()) {
    return memoryStore().events.filter((event) => event.runId === runId);
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkEvents)
    .where(eq(benchmarkEvents.runId, runId))
    .orderBy(desc(benchmarkEvents.createdAt));

  return rows.map(eventFromRow);
}

export async function listRecentCells(limit = 500) {
  if (!hasDatabase()) {
    return memoryStore().cells.slice(0, limit);
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkCells)
    .orderBy(desc(benchmarkCells.createdAt))
    .limit(limit);

  return rows.map(cellFromRow);
}

export async function markCellsStarting(cellIds: string[]) {
  if (cellIds.length === 0) {
    return;
  }

  const updatedAt = new Date();

  if (!hasDatabase()) {
    const store = memoryStore();
    store.cells = store.cells.map((cell) =>
      cellIds.includes(cell.id)
        ? { ...cell, status: "starting", updatedAt: updatedAt.toISOString() }
        : cell,
    );
    return;
  }

  const db = getDb();
  await db
    .update(benchmarkCells)
    .set({ status: "starting", updatedAt })
    .where(inArray(benchmarkCells.id, cellIds));
}

export async function updateCellSandbox(
  cellId: string,
  sandboxId: string | null,
  commandId: string | null,
  status: CellStatus,
) {
  const updatedAt = new Date();

  if (!hasDatabase()) {
    const store = memoryStore();
    store.cells = store.cells.map((cell) =>
      cell.id === cellId
        ? {
            ...cell,
            sandboxId,
            commandId,
            status,
            updatedAt: updatedAt.toISOString(),
          }
        : cell,
    );
    return;
  }

  const db = getDb();
  await db
    .update(benchmarkCells)
    .set({ sandboxId, commandId, status, updatedAt })
    .where(eq(benchmarkCells.id, cellId));
}

export async function addBenchmarkEvent(input: BenchmarkEventInput) {
  const createdAt = new Date();
  const event: BenchmarkEventRecord = {
    id: crypto.randomUUID(),
    runId: input.runId,
    cellId: input.cellId ?? null,
    type: input.type,
    message: input.message,
    payload: input.payload ?? null,
    createdAt: createdAt.toISOString(),
  };

  if (!hasDatabase()) {
    memoryStore().events.unshift(event);
    return event;
  }

  const db = getDb();
  const rows = await db
    .insert(benchmarkEvents)
    .values({ ...event, createdAt })
    .returning();

  return eventFromRow(rows[0]);
}

export async function completeCell(cellId: string, input: CompleteCellInput) {
  const updatedAt = new Date();
  const status = input.status;
  const patch: NormalizedResult & { status: "completed" | "failed" } = {
    status,
    score: input.score ?? null,
    passed: input.passed ?? null,
    durationMs: input.durationMs ?? null,
    tokenUsage: input.tokenUsage ?? null,
    costEstimate: input.costEstimate ?? null,
    logs: input.logs,
    artifacts: input.artifacts,
    rawHarnessResult: input.rawHarnessResult ?? null,
    error: input.error,
  };

  if (!hasDatabase()) {
    const store = memoryStore();
    const cell = store.cells.find((candidate) => candidate.id === cellId);
    if (!cell) {
      return null;
    }

    Object.assign(cell, {
      ...patch,
      updatedAt: updatedAt.toISOString(),
      completedAt: updatedAt.toISOString(),
    });
    await refreshRunCounts(cell.runId);
    return cell;
  }

  const db = getDb();
  const rows = await db
    .update(benchmarkCells)
    .set({
      ...patch,
      updatedAt,
      completedAt: updatedAt,
    })
    .where(eq(benchmarkCells.id, cellId))
    .returning();

  const cell = rows[0] ? cellFromRow(rows[0]) : null;
  if (cell) {
    await refreshRunCounts(cell.runId);
  }

  return cell;
}

export async function failCells(cellIds: string[], error: string) {
  if (cellIds.length === 0) {
    return;
  }

  const updatedAt = new Date();

  if (!hasDatabase()) {
    const store = memoryStore();
    store.cells = store.cells.map((cell) =>
      cellIds.includes(cell.id)
        ? {
            ...cell,
            status: "failed",
            error,
            updatedAt: updatedAt.toISOString(),
            completedAt: updatedAt.toISOString(),
          }
        : cell,
    );
    const runIds = new Set(
      store.cells
        .filter((cell) => cellIds.includes(cell.id))
        .map((cell) => cell.runId),
    );
    for (const runId of runIds) {
      await refreshRunCounts(runId);
    }
    return;
  }

  const db = getDb();
  await db
    .update(benchmarkCells)
    .set({
      status: "failed",
      error,
      updatedAt,
      completedAt: updatedAt,
    })
    .where(inArray(benchmarkCells.id, cellIds));
}

async function refreshRunCounts(runId: string) {
  const cells = await listCellsForRun(runId);
  const completedCellCount = cells.filter(
    (cell) => cell.status === "completed",
  ).length;
  const failedCellCount = cells.filter(
    (cell) => cell.status === "failed",
  ).length;
  const finishedCellCount = completedCellCount + failedCellCount;
  const run = await getRun(runId);
  const status =
    run && finishedCellCount >= run.cellCount
      ? failedCellCount > 0
        ? "failed"
        : "completed"
      : "running";
  const completedAt =
    run && finishedCellCount >= run.cellCount ? new Date() : null;
  const updatedAt = new Date();

  if (!hasDatabase()) {
    const store = memoryStore();
    store.runs = store.runs.map((candidate) =>
      candidate.id === runId
        ? {
            ...candidate,
            status,
            completedCellCount,
            failedCellCount,
            updatedAt: updatedAt.toISOString(),
            completedAt: completedAt ? completedAt.toISOString() : null,
          }
        : candidate,
    );
    return;
  }

  const db = getDb();
  await db
    .update(benchmarkRuns)
    .set({
      status,
      completedCellCount,
      failedCellCount,
      updatedAt,
      completedAt,
    })
    .where(eq(benchmarkRuns.id, runId));
}

export async function setRunRunning(runId: string) {
  const updatedAt = new Date();

  if (!hasDatabase()) {
    const store = memoryStore();
    store.runs = store.runs.map((run) =>
      run.id === runId
        ? { ...run, status: "running", updatedAt: updatedAt.toISOString() }
        : run,
    );
    return;
  }

  const db = getDb();
  await db
    .update(benchmarkRuns)
    .set({ status: "running", updatedAt })
    .where(eq(benchmarkRuns.id, runId));
}

export async function getCell(cellId: string) {
  if (!hasDatabase()) {
    return memoryStore().cells.find((cell) => cell.id === cellId) ?? null;
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkCells)
    .where(eq(benchmarkCells.id, cellId))
    .limit(1);

  return rows[0] ? cellFromRow(rows[0]) : null;
}

export async function getCellsForDispatch(runId: string, cellIds: string[]) {
  if (!hasDatabase()) {
    return memoryStore().cells.filter(
      (cell) => cell.runId === runId && cellIds.includes(cell.id),
    );
  }

  const db = getDb();
  const rows = await db
    .select()
    .from(benchmarkCells)
    .where(
      and(eq(benchmarkCells.runId, runId), inArray(benchmarkCells.id, cellIds)),
    );

  return rows.map(cellFromRow);
}

export async function getLeaderboard(): Promise<LeaderboardRow[]> {
  const cells = (await listRecentCells(1000)).filter(
    (cell) => cell.status === "completed" || cell.status === "failed",
  );
  type LeaderboardGroup = {
    suiteId: string;
    suiteName: string;
    harnessId: LeaderboardRow["harnessId"];
    modelId: string;
    modelName: string;
    cells: BenchmarkCellRecord[];
  };
  const groups = new Map<string, LeaderboardGroup>();

  for (const cell of cells) {
    const key = [
      cell.suiteId,
      cell.suiteName,
      cell.harnessId,
      cell.modelId,
      cell.modelName,
    ].join("::");
    const group = groups.get(key);
    if (group) {
      group.cells.push(cell);
    } else {
      groups.set(key, {
        suiteId: cell.suiteId,
        suiteName: cell.suiteName,
        harnessId: cell.harnessId,
        modelId: cell.modelId,
        modelName: cell.modelName,
        cells: [cell],
      });
    }
  }

  return Array.from(groups.values())
    .map((group) => {
      const cells = group.cells;
      const scored = cells.filter((cell) => typeof cell.score === "number");
      const passed = cells.filter((cell) => cell.passed === true).length;
      const completed = cells.filter(
        (cell) => cell.status === "completed",
      ).length;
      const failed = cells.filter((cell) => cell.status === "failed").length;
      const durations = cells
        .map((cell) => cell.durationMs)
        .filter((value): value is number => typeof value === "number");
      const costs = cells
        .map((cell) => cell.costEstimate)
        .filter((value): value is number => typeof value === "number");

      return {
        suiteId: group.suiteId,
        suiteName: group.suiteName,
        harnessId: group.harnessId,
        modelId: group.modelId,
        modelName: group.modelName,
        averageScore:
          scored.length > 0
            ? scored.reduce((total, cell) => total + (cell.score ?? 0), 0) /
              scored.length
            : null,
        passRate: cells.length > 0 ? (passed / cells.length) * 100 : null,
        completedCells: completed,
        failedCells: failed,
        averageDurationMs:
          durations.length > 0
            ? durations.reduce((total, duration) => total + duration, 0) /
              durations.length
            : null,
        estimatedCost:
          costs.length > 0
            ? costs.reduce((total, cost) => total + cost, 0)
            : null,
        latestRunId: cells[0]?.runId ?? null,
      };
    })
    .sort((a, b) => (b.averageScore ?? -1) - (a.averageScore ?? -1));
}
