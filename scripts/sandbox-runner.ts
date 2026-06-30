import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import { dirname, join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { Agent } from "@mastra/core/agent";
import { Codex } from "@openai/codex-sdk";
import { createOpencode } from "@opencode-ai/sdk";
import { Client } from "eve/client";
import { z } from "zod";
import type {
  Artifact,
  HarnessId,
  ModelConfig,
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
type CompleteStatus = "completed" | "failed" | "infra_failed";
type ProviderModel = {
  providerID: string;
  modelID: string;
};
type EveTurnResult = {
  message: string | undefined;
  events: readonly unknown[];
  sessionId: string;
  status: "completed" | "failed" | "waiting";
};
type SdkResult<T> =
  | {
      data: T;
      error: undefined;
      request: Request;
      response: Response;
    }
  | {
      data: undefined;
      error: unknown;
      request: Request;
      response: Response;
    };

type HarnessRunResult = {
  text: string;
  raw: unknown;
  artifacts?: Artifact[];
  tokenUsage?: NormalizedResult["tokenUsage"];
};

class InfrastructureFailure extends Error {}

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
      throw new InfrastructureFailure(
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
    const harnessOutputArtifact = await writeHarnessOutput(harnessResult.text);
    const scorerResult = importedTask?.scorerCommand
      ? await runScorer(importedTask.scorerCommand)
      : null;

    const normalized = normalizeResult(
      {
        ...harnessResult,
        artifacts: [...(harnessResult.artifacts ?? []), harnessOutputArtifact],
      },
      scorerResult,
    );
    await writeResult(normalized);
    await complete("completed", normalized);
  } catch (error) {
    const status =
      error instanceof InfrastructureFailure ? "infra_failed" : "failed";
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
    await complete(status, normalized);
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
  const model = providerModelFor(payload.cell.modelConfig);
  const instance = await createOpencode({
    config: {
      model: `${model.providerID}/${model.modelID}`,
    },
  });
  try {
    const session = requireOpenCodeSession(
      unwrapSdkResult(
        await instance.client.session.create({
          body: { title: `BenchHarness ${payload.cell.id}` },
          query: { directory: workspace },
        }),
        "OpenCode session create",
      ),
    );
    const response = unwrapSdkResult(
      await instance.client.session.prompt({
        path: { id: session.id },
        query: { directory: workspace },
        body: {
          model,
          parts: [{ type: "text", text: prompt }],
          system:
            "Run the benchmark task exactly per the task prompt and leave scoring to the benchmark scorer.",
          tools: {
            bash: true,
            edit: true,
            glob: true,
            grep: true,
            read: true,
            write: true,
          },
        },
      }),
      "OpenCode session prompt",
    );

    return {
      text: extractText(response),
      raw: response,
      tokenUsage: extractUsageFromParts(response),
    };
  } finally {
    instance.server.close();
  }
}

async function runEve(prompt: string): Promise<HarnessRunResult> {
  const appDir = join(workspace, ".benchharness", "eve", payload.cell.id);
  await writeEveApp(appDir);

  const port = await getFreePort();
  const client = new Client({
    host: `http://127.0.0.1:${port}`,
    maxReconnectAttempts: 5,
  });
  const logs: string[] = [];
  const childState: { error: string | null; exit: string | null } = {
    error: null,
    exit: null,
  };
  const child = spawn(
    eveBinaryPath(),
    [
      "dev",
      "--no-ui",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
      "--logs",
      "stderr",
      "--name",
      `BenchHarness ${payload.cell.id}`,
    ],
    {
      cwd: appDir,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    },
  );
  child.once("exit", (code, signal) => {
    childState.exit = `exit code ${String(code)} signal ${String(signal)}`;
  });
  child.once("error", (error) => {
    childState.error = error.message;
  });
  captureProcessOutput(child.stdout, "eve:stdout", logs);
  captureProcessOutput(child.stderr, "eve:stderr", logs);

  try {
    await waitForEveServer(
      client,
      logs,
      () => childState.exit,
      () => childState.error,
    );
    await postEvent("harness.message", "Eve dev server is ready.", {
      appDir,
      port,
    });
    const session = client.session();
    const response = await session.send(prompt);
    const result = await response.result();

    if (result.status === "failed") {
      throw new Error(`Eve session failed: ${eveFailureText(result)}`);
    }

    return {
      text: eveResultText(result),
      raw: result,
      tokenUsage: extractEveUsage(result.events),
      artifacts: [
        {
          label: "Eve agent app",
          kind: "file",
          path: appDir,
        },
      ],
    };
  } catch (error) {
    const reason = childState.error ?? childState.exit;
    if (reason) {
      throw new InfrastructureFailure(
        `Eve dev server failed before benchmark completion: ${sanitizeForLog(reason)}\n${processLogs(logs)}`,
      );
    }
    throw error;
  } finally {
    await stopProcess(child);
  }
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

async function writeHarnessOutput(text: string): Promise<Artifact> {
  const outputPath = join(workspace, "harness-output.txt");
  await writeFile(outputPath, text);
  return {
    label: "harness-output.txt",
    kind: "log",
    path: outputPath,
  };
}

async function complete(status: CompleteStatus, result: NormalizedResult) {
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

function extractUsageFromParts(value: unknown): NormalizedResult["tokenUsage"] {
  if (!isRecord(value)) {
    return null;
  }
  const parts = value.parts;
  if (!Array.isArray(parts)) {
    return null;
  }

  for (const part of parts) {
    if (!isRecord(part) || part.type !== "step-finish") {
      continue;
    }
    const tokens = part.tokens;
    if (!isRecord(tokens)) {
      continue;
    }
    return {
      input: numberish(tokens.input),
      output: numberish(tokens.output),
    };
  }

  return null;
}

function extractEveUsage(
  events: readonly unknown[],
): NormalizedResult["tokenUsage"] {
  let input = 0;
  let output = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let seen = false;

  for (const event of events) {
    if (!isRecord(event) || event.type !== "step.completed") {
      continue;
    }
    const data = event.data;
    if (!isRecord(data)) {
      continue;
    }
    const usage = data.usage;
    if (!isRecord(usage)) {
      continue;
    }
    seen = true;
    input += numberish(usage.inputTokens) ?? 0;
    output += numberish(usage.outputTokens) ?? 0;
    cacheRead += numberish(usage.cacheReadTokens) ?? 0;
    cacheWrite += numberish(usage.cacheWriteTokens) ?? 0;
  }

  if (!seen) {
    return null;
  }

  return { input, output, cacheRead, cacheWrite };
}

async function writeEveApp(appDir: string) {
  await mkdir(join(appDir, "agent"), { recursive: true });
  const app = eveAppDefinition(payload.cell.modelConfig);
  await writeFile(
    join(appDir, "package.json"),
    JSON.stringify(
      {
        name: `benchharness-eve-${payload.cell.id}`,
        private: true,
        type: "module",
        dependencies: {
          ...app.dependencies,
          eve: "0.17.1",
          zod: "^4.4.3",
        },
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(appDir, "agent", "agent.ts"),
    [
      ...app.imports,
      "",
      "export default defineAgent({",
      app.modelLine,
      "});",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(appDir, "agent", "instructions.md"),
    [
      "You are running in the Eve harness inside BenchHarness.",
      "Complete the benchmark task exactly per the task text.",
      "Use Eve's default shell and filesystem tools when artifacts are required.",
      "Do not invent benchmark scores; BenchHarness runs the scorer after your turn completes.",
      "",
    ].join("\n"),
  );
}

function eveAppDefinition(modelConfig: ModelConfig) {
  if (modelConfig.provider === "anthropic") {
    return {
      dependencies: { "@ai-sdk/anthropic": "^4.0.3" },
      imports: [
        'import { anthropic } from "@ai-sdk/anthropic";',
        'import { defineAgent } from "eve";',
      ],
      modelLine: `  model: anthropic(${JSON.stringify(eveAnthropicModelId(modelConfig.model))}),`,
    };
  }

  return {
    dependencies: {},
    imports: ['import { defineAgent } from "eve";'],
    modelLine: `  model: ${JSON.stringify(eveGatewayModelId(modelConfig.model))},`,
  };
}

function eveAnthropicModelId(model: string) {
  if (model.startsWith("anthropic/")) {
    const nativeModel = model.slice("anthropic/".length);
    return nativeModel === "claude-opus-4.8" ? "claude-opus-4-8" : nativeModel;
  }

  return model === "claude-opus-4.8" ? "claude-opus-4-8" : model;
}

function eveGatewayModelId(model: string) {
  if (model === "claude-opus-4-8" || model === "anthropic/claude-opus-4-8") {
    return "anthropic/claude-opus-4.8";
  }

  return model;
}

function eveBinaryPath() {
  const localBinary = join(workspace, "node_modules", ".bin", "eve");
  return existsSync(localBinary) ? localBinary : "eve";
}

function getFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (typeof address === "object" && address !== null) {
        const port = address.port;
        server.close((error) => {
          if (error) {
            reject(error);
          } else {
            resolve(port);
          }
        });
        return;
      }

      server.close(() => {
        reject(new Error("Could not allocate a local port for Eve."));
      });
    });
  });
}

function captureProcessOutput(
  stream: NodeJS.ReadableStream | null,
  label: string,
  logs: string[],
) {
  if (!stream) {
    return;
  }

  stream.on("data", (chunk: Uint8Array | string) => {
    const text =
      typeof chunk === "string" ? chunk : Buffer.from(chunk).toString("utf8");
    logs.push(`[${label}] ${text}`);
    while (logs.length > 200) {
      logs.shift();
    }
  });
}

async function waitForEveServer(
  client: Client,
  logs: string[],
  childExit: () => string | null,
  childError: () => string | null,
) {
  const deadline = Date.now() + 120_000;
  let lastError = "health check has not run";

  while (Date.now() < deadline) {
    const error = childError();
    if (error) {
      throw new InfrastructureFailure(
        `Eve dev failed to start: ${sanitizeForLog(error)}\n${processLogs(logs)}`,
      );
    }

    const exit = childExit();
    if (exit) {
      throw new InfrastructureFailure(
        `Eve dev exited before becoming ready: ${sanitizeForLog(exit)}\n${processLogs(logs)}`,
      );
    }

    try {
      await client.health();
      return;
    } catch (error) {
      lastError =
        error instanceof Error ? error.message : "Unknown Eve health error.";
    }

    await sleep(500);
  }

  throw new InfrastructureFailure(
    `Eve dev did not become ready within 120000ms. Last health error: ${sanitizeForLog(lastError)}\n${processLogs(logs)}`,
  );
}

function stopProcess(child: ReturnType<typeof spawn>) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve();
  }

  child.kill("SIGTERM");
  return new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      if (child.exitCode === null && child.signalCode === null) {
        child.kill("SIGKILL");
      }
      resolve();
    }, 5000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function processLogs(logs: string[]) {
  return sanitizeForLog(logs.join("").slice(-20_000));
}

function eveResultText(result: EveTurnResult) {
  if (result.message) {
    return result.message;
  }

  return JSON.stringify(
    {
      status: result.status,
      sessionId: result.sessionId,
      events: result.events.map(eventType),
    },
    null,
    2,
  );
}

function eveFailureText(result: EveTurnResult) {
  const failures: string[] = [];
  for (const event of result.events) {
    if (!isRecord(event)) {
      continue;
    }
    if (event.type !== "step.failed" && event.type !== "turn.failed") {
      continue;
    }
    const data = event.data;
    if (!isRecord(data)) {
      continue;
    }
    const message = data.message;
    if (typeof message === "string") {
      failures.push(message);
    }
  }

  return failures.length > 0 ? failures.join("\n") : eveResultText(result);
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

function providerModelFor(modelConfig: ModelConfig): ProviderModel {
  const separatorIndex = modelConfig.model.indexOf("/");
  if (separatorIndex > 0 && separatorIndex < modelConfig.model.length - 1) {
    return {
      providerID: modelConfig.model.slice(0, separatorIndex),
      modelID: modelConfig.model.slice(separatorIndex + 1),
    };
  }

  const providerID = modelConfig.providerId ?? modelConfig.provider;
  if (!providerID) {
    throw new Error(
      `Model ${modelConfig.id} must include provider or providerId for OpenCode.`,
    );
  }

  return {
    providerID,
    modelID: modelConfig.model,
  };
}

function unwrapSdkResult<T>(result: SdkResult<T>, operation: string): T {
  if (result.error !== undefined) {
    throw new Error(`${operation} failed: ${extractText(result.error)}`);
  }

  if (result.data === undefined) {
    throw new Error(`${operation} failed without data.`);
  }

  return result.data;
}

function requireOpenCodeSession(value: unknown) {
  if (!isRecord(value) || typeof value.id !== "string") {
    throw new Error("OpenCode session create failed without a session id.");
  }

  return { id: value.id };
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
