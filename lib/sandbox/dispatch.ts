import {
  addBenchmarkEvent,
  getRun,
  listCellsForRun,
  setRunRunning,
  updateCellSandbox,
} from "@/lib/db/repository";
import { dispatchCellToSandbox, getSandboxConfigurationIssue } from "./vercel";

type VercelDispatchAuth = {
  oidcToken?: string | null;
};

export class SandboxDispatchOrchestrator {
  async dispatchQueuedCells(runId: string, auth?: VercelDispatchAuth) {
    const run = await getRun(runId);
    if (!run) {
      return { launched: 0, skipped: 0, reason: "Run not found." };
    }

    const configurationIssue = getSandboxConfigurationIssue();
    if (configurationIssue) {
      await addBenchmarkEvent({
        runId,
        type: "dispatch.skipped",
        message: configurationIssue,
        payload: { configurationIssue },
      });
      return {
        launched: 0,
        skipped: run.cellCount,
        reason: configurationIssue,
      };
    }

    const cells = await listCellsForRun(runId);
    const active = cells.filter(
      (cell) => cell.status === "starting" || cell.status === "running",
    ).length;
    const slots = Math.max(0, run.maxConcurrency - active);
    const queued = cells
      .filter((cell) => cell.status === "queued")
      .slice(0, slots);

    if (queued.length === 0) {
      return { launched: 0, skipped: 0, reason: null };
    }

    await setRunRunning(runId);

    let launched = 0;
    let skipped = 0;
    for (const cell of queued) {
      await updateCellSandbox(cell.id, null, null, "starting");
      try {
        const result = await dispatchCellToSandbox(cell, auth);
        if (result.ok) {
          launched += 1;
          await updateCellSandbox(
            cell.id,
            result.sandboxId,
            result.commandId,
            "running",
          );
          await addBenchmarkEvent({
            runId,
            cellId: cell.id,
            type: "cell.dispatched",
            message: `Dispatched ${cell.harnessId}/${cell.modelId} to sandbox.`,
            payload: {
              sandboxId: result.sandboxId,
              commandId: result.commandId,
            },
          });
        } else {
          skipped += 1;
          await updateCellSandbox(cell.id, null, null, "queued");
          await addBenchmarkEvent({
            runId,
            cellId: cell.id,
            type: "cell.dispatch_skipped",
            message: result.reason,
            payload: { reason: result.reason },
          });
        }
      } catch (error) {
        skipped += 1;
        const message =
          error instanceof Error
            ? error.message
            : "Unknown sandbox dispatch error.";
        await updateCellSandbox(cell.id, null, null, "queued");
        await addBenchmarkEvent({
          runId,
          cellId: cell.id,
          type: "cell.dispatch_failed",
          message,
          payload: { message },
        });
      }
    }

    return { launched, skipped, reason: null };
  }
}

export const sandboxDispatchOrchestrator = new SandboxDispatchOrchestrator();

export async function dispatchQueuedCells(
  runId: string,
  auth?: VercelDispatchAuth,
) {
  return sandboxDispatchOrchestrator.dispatchQueuedCells(runId, auth);
}
