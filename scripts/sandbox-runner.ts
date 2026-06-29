import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Agent } from "@mastra/core/agent";
import { Codex } from "@openai/codex-sdk";
import { createOpencode } from "@opencode-ai/sdk";
import { z } from "zod";
import type {
  Artifact,
  HarnessId,
  NormalizedResult,
} from "@/lib/benchmarks/types";
import {
  cellStatuses,
  codexProviderModes,
  codexWireApis,
  harnessIds,
} from "@/lib/benchmarks/types";
import { buildCodexConfig, sanitizeForLog } from "@/lib/harnesses/adapters";

const tokenUsageSchema = z
  .object({
    input: z.number().int().min(0).optional(),
    output: z.number().int().min(0).optional(),
    cacheRead: z.number().int().min(0).optional(),
    cacheWrite: z.number().int().min(0).optional(),
  })
  .nullable();

const artifactSchema = z.object({
  label: z.string(),
  path: z.string().optional(),
  url: z.string().optional(),
  kind: z.enum(["log", "patch", "json", "file", "screenshot"]),
});

const modelConfigSchema = z.object({
  id: z.string(),
  displayName: z.string().optional(),
  provider: z.string().optional(),
  providerId: z.string().optional(),
  model: z.string(),
  baseUrl: z.string().optional(),
  apiKeyEnv: z.string().optional(),
  codexProviderMode: z.enum(codexProviderModes).optional(),
  wireApi: z.enum(codexWireApis).optional(),
});

const benchmarkTaskSchema = z.object({
  id: z.string(),
  suiteId: z.string(),
  title: z.string(),
  prompt: z.string(),
  expectedArtifacts: z.array(z.string()),
  sourceRef: z.string(),
  requiresOperatorImport: z.boolean(),
});

const benchmarkCellSchema = z.object({
  id: z.string(),
  runId: z.string(),
  suiteId: z.string(),
  suiteName: z.string(),
  taskId: z.string(),
  taskTitle: z.string(),
  harnessId: z.enum(harnessIds),
  modelId: z.string(),
  modelName: z.string(),
  modelProvider: z.string().nullable(),
  modelConfig: modelConfigSchema,
  status: z.enum(cellStatuses),
  sandboxId: z.string().nullable(),
  commandId: z.string().nullable(),
  score: z.number().nullable(),
  passed: z.boolean().nullable(),
  durationMs: z.number().nullable(),
  tokenUsage: tokenUsageSchema,
  costEstimate: z.number().nullable(),
  logs: z.string().nullable(),
  artifacts: z.array(artifactSchema),
  error: z.string().nullable(),
  rawHarnessResult: z.unknown(),
  createdAt: z.string(),
  updatedAt: z.string(),
  completedAt: z.string().nullable(),
});

const sandboxRunnerPayloadSchema = z.object({
  cell: benchmarkCellSchema,
  task: benchmarkTaskSchema,
  callbackBaseUrl: z.string(),
});

const importedTaskSchema = z.object({
  prompt: z.string().optional(),
  setupCommand: z.string().optional(),
  scorerCommand: z.string().optional(),
  expectedArtifacts: z.array(z.string()).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

const normalizedResultPatchSchema = z
  .object({
    score: z.number().nullable(),
    passed: z.boolean().nullable(),
    durationMs: z.number().nullable(),
    tokenUsage: tokenUsageSchema,
    costEstimate: z.number().nullable(),
    logs: z.string(),
    artifacts: z.array(artifactSchema),
    rawHarnessResult: z.unknown(),
    error: z.string().optional(),
  })
  .partial();

type SandboxRunnerPayload = z.infer<typeof sandboxRunnerPayloadSchema>;
type ImportedTask = z.infer<typeof importedTaskSchema>;

type HarnessRunResult = {
  text: string;
  raw: unknown;
  artifacts?: Artifact[];
  tokenUsage?: NormalizedResult["tokenUsage"];
};

abstract class SandboxHarnessExecutor {
  protected constructor(readonly id: HarnessId) {}

  abstract run(prompt: string): Promise<HarnessRunResult>;
}

class ClaudeCodeExecutor extends SandboxHarnessExecutor {
  constructor() {
    super("claude-code");
  }

  run(prompt: string) {
    return runClaudeCode(prompt);
  }
}

class CodexExecutor extends SandboxHarnessExecutor {
  constructor() {
    super("codex");
  }

  run(prompt: string) {
    return runCodex(prompt);
  }
}

class OpenCodeExecutor extends SandboxHarnessExecutor {
  constructor() {
    super("opencode");
  }

  run(prompt: string) {
    return runOpenCode(prompt);
  }
}

class EveExecutor extends SandboxHarnessExecutor {
  constructor() {
    super("eve");
  }

  run(prompt: string) {
    return runEve(prompt);
  }
}

class MastraExecutor extends SandboxHarnessExecutor {
  constructor() {
    super("mastra");
  }

  run(prompt: string) {
    return runMastra(prompt);
  }
}

class SandboxHarnessRunnerRegistry {
  private readonly executors: Map<HarnessId, SandboxHarnessExecutor>;

  constructor(executors: SandboxHarnessExecutor[]) {
    this.executors = new Map(
      executors.map((executor) => [executor.id, executor]),
    );
  }

  run(harnessId: HarnessId, prompt: string) {
    const executor = this.executors.get(harnessId);
    if (!executor) {
      throw new Error(`Unsupported harness ${harnessId}.`);
    }

    return executor.run(prompt);
  }
}

const sandboxHarnessRunnerRegistry = new SandboxHarnessRunnerRegistry([
  new ClaudeCodeExecutor(),
  new CodexExecutor(),
  new OpenCodeExecutor(),
  new EveExecutor(),
  new MastraExecutor(),
]);

const payload = parsePayload();
const workspace = process.env.BENCH_WORKSPACE ?? process.cwd();
const startedAt = Date.now();

await main();

async function main() {
  try {
    await postEvent("cell.started", "Sandbox runner started.", {
      workspace,
      harnessId: payload.cell.harnessId,
    });

    const importedTask = await readImportedTask();
    if (!importedTask && payload.task.requiresOperatorImport) {
      throw new Error(
        `Benchmark task assets are missing for ${payload.task.suiteId}/${payload.task.id}. Import the suite task under benchmarks/${payload.task.suiteId}/${payload.task.id}.json before scoring this cell.`,
      );
    }

    if (importedTask?.setupCommand) {
      await postEvent("cell.setup", "Running imported task setup command.", {
        command: importedTask.setupCommand,
      });
      await runShell(importedTask.setupCommand);
    }

    const prompt = buildPrompt(importedTask);
    const harnessResult = await runHarness(prompt);
    const scorerResult = importedTask?.scorerCommand
      ? await runScorer(importedTask.scorerCommand)
      : null;

    const normalized = normalizeResult(harnessResult, scorerResult);
    await writeResult(normalized);
    await complete("completed", normalized);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Unknown sandbox runner failure.";
    const normalized: NormalizedResult = {
      score: null,
      passed: false,
      durationMs: Date.now() - startedAt,
      tokenUsage: null,
      costEstimate: null,
      logs: sanitizeForLog(message),
      artifacts: [],
      rawHarnessResult: null,
      error: sanitizeForLog(message),
    };

    await writeResult(normalized).catch(() => undefined);
    await complete("failed", normalized);
    process.exitCode = 1;
  }
}

function parsePayload(): SandboxRunnerPayload {
  const raw = process.env.BENCH_CELL_PAYLOAD;
  if (!raw) {
    throw new Error("BENCH_CELL_PAYLOAD is missing.");
  }
  return sandboxRunnerPayloadSchema.parse(JSON.parse(raw));
}

async function readImportedTask() {
  const taskPath = join(
    workspace,
    "benchmarks",
    payload.task.suiteId,
    `${payload.task.id}.json`,
  );
  if (!existsSync(taskPath)) {
    return null;
  }

  return importedTaskSchema.parse(JSON.parse(await readFile(taskPath, "utf8")));
}

function buildPrompt(importedTask: ImportedTask | null) {
  return [
    importedTask?.prompt ?? payload.task.prompt,
    "",
    "Benchmark runner requirements:",
    "- Work only inside the sandbox workspace.",
    "- Produce artifacts requested by the benchmark task.",
    "- Do not fabricate scores. The scorer command or result.json contract determines the score.",
  ].join("\n");
}

async function runHarness(prompt: string): Promise<HarnessRunResult> {
  return sandboxHarnessRunnerRegistry.run(payload.cell.harnessId, prompt);
}

async function runClaudeCode(prompt: string): Promise<HarnessRunResult> {
  const messages: unknown[] = [];

  for await (const message of query({
    prompt,
    options: {
      cwd: workspace,
      model: payload.cell.modelConfig.model,
      allowedTools: ["Bash", "Read", "Write", "Edit", "Grep", "Glob"],
      permissionMode: "bypassPermissions",
      allowDangerouslySkipPermissions: true,
    },
  })) {
    messages.push(message);
    await postEvent("harness.message", "Claude Code emitted an event.", {
      type: eventType(message),
    });
  }

  return {
    text: extractText(messages),
    raw: messages,
  };
}

async function runCodex(prompt: string): Promise<HarnessRunResult> {
  const config = buildCodexConfig(payload.cell.modelConfig);
  const codex = new Codex({
    config,
    env: buildSdkEnv(),
  });
  const thread = codex.startThread({
    workingDirectory: workspace,
    skipGitRepoCheck: true,
  });
  const turn = await thread.run(prompt);

  return {
    text: extractText(turn),
    raw: turn,
    tokenUsage: extractUsage(turn),
  };
}

async function runOpenCode(prompt: string): Promise<HarnessRunResult> {
  const instance = await createOpencode();
  try {
    const promptPath = join(workspace, "opencode-prompt.txt");
    await writeFile(promptPath, prompt);
    const raw = {
      note: "OpenCode SDK server/client initialized. The imported benchmark scorer should drive the OpenCode session using this prompt file.",
      model: payload.cell.modelConfig.model,
      promptPath,
      clientAvailable: Boolean(instance.client),
      serverAvailable: Boolean(instance.server),
    };
    return { text: JSON.stringify(raw, null, 2), raw };
  } finally {
    instance.server.close();
  }
}

async function runEve(prompt: string): Promise<HarnessRunResult> {
  const agentDir = join(workspace, "eve-agent");
  await mkdir(agentDir, { recursive: true });
  const agentSource = [
    "export default {",
    `  model: ${JSON.stringify(payload.cell.modelConfig.model)},`,
    "  async run() {",
    `    return ${JSON.stringify(prompt)};`,
    "  }",
    "};",
  ].join("\n");
  await writeFile(join(agentDir, "agent.ts"), agentSource);

  return {
    text: "Generated an Eve filesystem-first agent template for the imported benchmark task.",
    raw: { agentDir, model: payload.cell.modelConfig.model },
    artifacts: [{ label: "Eve agent template", kind: "file", path: agentDir }],
  };
}

async function runMastra(prompt: string): Promise<HarnessRunResult> {
  const agent = new Agent({
    id: "benchmark-agent",
    name: "Benchmark Agent",
    instructions:
      "Run the benchmark task exactly per the task prompt and leave scoring to the benchmark scorer.",
    model: payload.cell.modelConfig.model,
  });
  const response = await agent.generate(prompt);

  return {
    text: extractText(response),
    raw: response,
    tokenUsage: extractUsage(response),
  };
}

async function runScorer(command: string) {
  await postEvent("cell.scoring", "Running imported benchmark scorer.", {
    command,
  });
  await runShell(command);
  const resultPath = join(workspace, "result.json");
  if (!existsSync(resultPath)) {
    throw new Error(
      "Scorer command completed but did not produce result.json.",
    );
  }
  return normalizedResultPatchSchema.parse(
    JSON.parse(await readFile(resultPath, "utf8")),
  );
}

function normalizeResult(
  harnessResult: HarnessRunResult,
  scorerResult: Partial<NormalizedResult> | null,
): NormalizedResult {
  return {
    score: scorerResult?.score ?? null,
    passed: scorerResult?.passed ?? null,
    durationMs: Date.now() - startedAt,
    tokenUsage: scorerResult?.tokenUsage ?? harnessResult.tokenUsage ?? null,
    costEstimate: scorerResult?.costEstimate ?? null,
    logs: sanitizeForLog(
      [harnessResult.text, scorerResult?.logs].filter(Boolean).join("\n\n"),
    ),
    artifacts: [
      ...(harnessResult.artifacts ?? []),
      ...(scorerResult?.artifacts ?? []),
      {
        label: "result.json",
        kind: "json",
        path: join(workspace, "result.json"),
      },
    ],
    rawHarnessResult: scorerResult?.rawHarnessResult ?? harnessResult.raw,
    error: scorerResult?.error,
  };
}

async function writeResult(result: NormalizedResult) {
  const resultPath = join(workspace, "result.json");
  await mkdir(dirname(resultPath), { recursive: true });
  await writeFile(resultPath, JSON.stringify(result, null, 2));
}

async function complete(
  status: "completed" | "failed",
  result: NormalizedResult,
) {
  await postInternal(
    `/api/internal/benchmark-cells/${payload.cell.id}/complete`,
    {
      status,
      ...result,
    },
  );
}

async function postEvent(
  type: string,
  message: string,
  eventPayload?: unknown,
) {
  await postInternal("/api/internal/benchmark-events", {
    runId: payload.cell.runId,
    cellId: payload.cell.id,
    type,
    message,
    payload: eventPayload,
  });
}

async function postInternal(path: string, body: unknown) {
  const response = await fetch(`${payload.callbackBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.BENCH_START_SECRET ?? ""}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Callback ${path} failed with ${response.status}: ${text}`);
  }
}

function runShell(command: string) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn("bash", ["-lc", command], {
      cwd: workspace,
      env: process.env,
      stdio: "inherit",
    });
    child.once("error", reject);
    child.once("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Command failed with exit code ${code}: ${command}`));
      }
    });
  });
}

function extractText(value: unknown): string {
  if (!value) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (isRecord(value) && "finalResponse" in value) {
    const response = value.finalResponse;
    return typeof response === "string" ? response : JSON.stringify(response);
  }

  return JSON.stringify(value, null, 2);
}

function extractUsage(value: unknown): NormalizedResult["tokenUsage"] {
  if (!isRecord(value)) {
    return null;
  }
  const usage = value.usage;
  if (!isRecord(usage)) {
    return null;
  }
  return {
    input: numberish(usage.input_tokens ?? usage.inputTokens),
    output: numberish(usage.output_tokens ?? usage.outputTokens),
  };
}

function numberish(value: unknown) {
  return typeof value === "number" ? value : undefined;
}

function buildSdkEnv(): Record<string, string> {
  const env: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) {
    if (value !== undefined) {
      env[key] = value;
    }
  }

  const apiKeyEnv = payload.cell.modelConfig.apiKeyEnv;
  if (apiKeyEnv && process.env[apiKeyEnv]) {
    env[apiKeyEnv] = process.env[apiKeyEnv];
  }
  return env;
}

function eventType(value: unknown) {
  if (isRecord(value) && "type" in value) {
    return value.type;
  }
  return typeof value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
