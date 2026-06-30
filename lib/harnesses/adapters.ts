import type {
  BenchmarkCellRecord,
  BenchmarkTask,
  CodexProviderMode,
  CodexWireApi,
  HarnessId,
  ModelConfig,
} from "@/lib/benchmarks/types";

export type SandboxRunnerPayload = {
  cell: BenchmarkCellRecord;
  task: BenchmarkTask;
  callbackBaseUrl: string;
};

export type SandboxCommandPlan = {
  command: string;
  args: string[];
  cwd: string;
  env: Record<string, string>;
  wait: boolean;
  logs: boolean;
  timeout: number;
};

export type HarnessDescriptor = {
  id: HarnessId;
  label: string;
  providerPolicy: string;
  sdkPackage: string | null;
  summary: string;
};

export type CodexConfigValue =
  | string
  | number
  | boolean
  | CodexConfigValue[]
  | CodexConfigObject;

export type CodexConfigObject = {
  [key: string]: CodexConfigValue;
};

type SandboxPlanInput = {
  cell: BenchmarkCellRecord;
  task: BenchmarkTask;
  callbackBaseUrl: string;
};

export abstract class AgentHarness {
  protected constructor(readonly descriptor: HarnessDescriptor) {}

  get id() {
    return this.descriptor.id;
  }

  validateModelConfig(_modelConfig: ModelConfig): string[] {
    return [];
  }

  buildSandboxCommand(input: SandboxPlanInput): SandboxCommandPlan {
    return {
      command: "bash",
      args: ["-lc", this.runnerCommand()],
      cwd: "/vercel/sandbox",
      env: this.buildSandboxEnv(input),
      wait: false,
      logs: false,
      timeout: 3600000,
    };
  }

  buildSandboxEnv({ cell, task, callbackBaseUrl }: SandboxPlanInput) {
    const payload = this.buildSandboxRunnerPayload(cell, task, callbackBaseUrl);
    const env: Record<string, string> = {
      BENCH_CELL_PAYLOAD: JSON.stringify(payload),
      BENCH_CALLBACK_BASE_URL: callbackBaseUrl,
    };

    const apiKeyEnv = cell.modelConfig.apiKeyEnv;
    if (apiKeyEnv && process.env[apiKeyEnv]) {
      env[apiKeyEnv] = process.env[apiKeyEnv] ?? "";
    }

    if (process.env.BENCH_START_SECRET) {
      env.BENCH_START_SECRET = process.env.BENCH_START_SECRET;
    }

    return env;
  }

  buildSandboxRunnerPayload(
    cell: BenchmarkCellRecord,
    task: BenchmarkTask,
    callbackBaseUrl: string,
  ): SandboxRunnerPayload {
    return { cell, task, callbackBaseUrl };
  }

  protected runnerCommand() {
    return "npm install -g bun@1.3.12 && bun install --frozen-lockfile && bun run scripts/sandbox-runner.ts";
  }
}

export class ClaudeCodeHarness extends AgentHarness {
  constructor() {
    super({
      id: "claude-code",
      label: "Claude Code",
      providerPolicy: "Anthropic models only",
      sdkPackage: "@anthropic-ai/claude-agent-sdk",
      summary:
        "Claude Agent SDK query runner with bash/read/edit tools enabled.",
    });
  }

  override validateModelConfig(modelConfig: ModelConfig) {
    return modelConfig.provider === "anthropic"
      ? []
      : ["Claude Code only accepts Anthropic model configurations."];
  }
}

export class CodexHarness extends AgentHarness {
  constructor() {
    super({
      id: "codex",
      label: "Codex",
      providerPolicy:
        "OpenAI models, Responses-compatible endpoints, or Chat-compatible endpoints",
      sdkPackage: "@openai/codex-sdk",
      summary:
        "Codex SDK thread runner with explicit OpenAI, Responses-compatible, or Chat-compatible provider modes.",
    });
  }

  override validateModelConfig(modelConfig: ModelConfig) {
    const providerMode = resolveCodexProviderMode(modelConfig);
    const wireApi = resolveCodexWireApi(modelConfig);
    const usesAnthropicOpenAIEndpoint =
      isAnthropicOpenAICompatibleCodexProvider(modelConfig);
    const errors: string[] = [];

    if (providerMode === "openai") {
      if (modelConfig.baseUrl) {
        errors.push(
          "Codex OpenAI mode must not include baseUrl. Use responses-compatible or chat-compatible for custom endpoints.",
        );
      }
      if (modelConfig.providerId && modelConfig.providerId !== "openai") {
        errors.push(
          "Codex OpenAI mode must use providerId 'openai' or omit providerId.",
        );
      }
      if (wireApi !== "responses") {
        errors.push("Codex OpenAI mode uses the Responses API wire format.");
      }
    }

    if (providerMode !== "openai" && !modelConfig.baseUrl) {
      errors.push(
        `Codex ${providerMode} mode requires a baseUrl for the OpenAI-compatible endpoint.`,
      );
    }

    if (providerMode === "responses-compatible" && wireApi !== "responses") {
      errors.push(
        "Codex responses-compatible mode must use wireApi 'responses'.",
      );
    }

    if (providerMode === "chat-compatible" && wireApi !== "chat") {
      errors.push("Codex chat-compatible mode must use wireApi 'chat'.");
    }

    if (usesAnthropicOpenAIEndpoint && providerMode !== "chat-compatible") {
      errors.push(
        "Codex Anthropic OpenAI-compatible endpoint must use codexProviderMode 'chat-compatible'.",
      );
    }

    if (usesAnthropicOpenAIEndpoint && wireApi !== "chat") {
      errors.push(
        "Codex Anthropic OpenAI-compatible endpoint must use wireApi 'chat'.",
      );
    }

    return errors;
  }

  buildCodexConfig(modelConfig: ModelConfig): CodexConfigObject {
    const providerMode = resolveCodexProviderMode(modelConfig);
    const wireApi = resolveCodexWireApi(modelConfig);
    const providerId = resolveCodexProviderId(modelConfig, providerMode);
    const config: CodexConfigObject = {
      model: modelConfig.model,
      model_provider: providerId,
      sandbox_workspace_write: { network_access: true },
    };

    if (shouldBuildCodexProviderConfig(modelConfig, providerMode)) {
      const providerConfig: CodexConfigObject = {
        name: providerId,
        wire_api: wireApi,
      };
      if (modelConfig.baseUrl) {
        providerConfig.base_url = modelConfig.baseUrl;
      }
      if (modelConfig.apiKeyEnv) {
        providerConfig.env_key = modelConfig.apiKeyEnv;
      }
      if (providerMode !== "openai") {
        providerConfig.supports_websockets = false;
      }

      config.model_providers = {
        [providerId]: providerConfig,
      };
    }

    return config;
  }
}

export function resolveCodexProviderMode(
  modelConfig: ModelConfig,
): CodexProviderMode {
  if (modelConfig.codexProviderMode) {
    return modelConfig.codexProviderMode;
  }
  if (modelConfig.wireApi === "chat") {
    return "chat-compatible";
  }
  if (
    modelConfig.baseUrl &&
    isAnthropicOpenAICompatibleCodexProvider(modelConfig)
  ) {
    return "chat-compatible";
  }
  if (modelConfig.baseUrl) {
    return "responses-compatible";
  }
  return "openai";
}

export function resolveCodexWireApi(modelConfig: ModelConfig): CodexWireApi {
  if (modelConfig.wireApi) {
    return modelConfig.wireApi;
  }
  if (resolveCodexProviderMode(modelConfig) === "chat-compatible") {
    return "chat";
  }
  return "responses";
}

export function resolveCodexProviderId(
  modelConfig: ModelConfig,
  providerMode: CodexProviderMode,
) {
  if (modelConfig.providerId) {
    return modelConfig.providerId;
  }
  if (providerMode === "openai") {
    return "openai";
  }
  if (modelConfig.provider) {
    return modelConfig.provider;
  }
  return modelConfig.id;
}

function isAnthropicOpenAICompatibleCodexProvider(modelConfig: ModelConfig) {
  return (
    modelConfig.provider === "anthropic" ||
    modelConfig.providerId === "anthropic"
  );
}

function shouldBuildCodexProviderConfig(
  modelConfig: ModelConfig,
  providerMode: CodexProviderMode,
) {
  return (
    providerMode !== "openai" ||
    Boolean(modelConfig.apiKeyEnv) ||
    Boolean(modelConfig.baseUrl) ||
    Boolean(modelConfig.providerId && modelConfig.providerId !== "openai")
  );
}

export class OpenCodeHarness extends AgentHarness {
  constructor() {
    super({
      id: "opencode",
      label: "OpenCode",
      providerPolicy: "OpenCode provider/model identifiers",
      sdkPackage: "@opencode-ai/sdk",
      summary:
        "OpenCode server/client runner with harness-native model strings.",
    });
  }
}

export class EveHarness extends AgentHarness {
  constructor() {
    super({
      id: "eve",
      label: "Eve",
      providerPolicy: "Eve project model identifiers",
      sdkPackage: null,
      summary:
        "Eve filesystem-first project template running inside Vercel Sandbox.",
    });
  }
}

export class MastraHarness extends AgentHarness {
  constructor() {
    super({
      id: "mastra",
      label: "Mastra",
      providerPolicy: "Mastra model identifiers",
      sdkPackage: "@mastra/core",
      summary:
        "Mastra Agent/AgentController-style runner with normalized result output.",
    });
  }
}

export class HarnessOrchestrator {
  private readonly harnesses: Map<HarnessId, AgentHarness>;

  constructor(harnesses: AgentHarness[]) {
    this.harnesses = new Map(harnesses.map((harness) => [harness.id, harness]));
  }

  listHarnesses() {
    return Array.from(this.harnesses.values());
  }

  listDescriptors() {
    return this.listHarnesses().map((harness) => harness.descriptor);
  }

  getHarness(harnessId: HarnessId) {
    return this.harnesses.get(harnessId) ?? null;
  }

  requireHarness(harnessId: HarnessId) {
    const harness = this.getHarness(harnessId);
    if (!harness) {
      throw new Error(`Harness '${harnessId}' is not registered.`);
    }
    return harness;
  }

  validateModelConfig(harnessId: HarnessId, modelConfig: ModelConfig) {
    return this.requireHarness(harnessId).validateModelConfig(modelConfig);
  }

  buildSandboxCommand(input: SandboxPlanInput) {
    return this.requireHarness(input.cell.harnessId).buildSandboxCommand(input);
  }

  buildSandboxEnv(input: SandboxPlanInput) {
    return this.requireHarness(input.cell.harnessId).buildSandboxEnv(input);
  }

  buildCodexConfig(modelConfig: ModelConfig) {
    const harness = this.requireHarness("codex");
    if (!(harness instanceof CodexHarness)) {
      throw new Error("Registered Codex harness does not expose Codex config.");
    }

    return harness.buildCodexConfig(modelConfig);
  }
}

export const harnessOrchestrator = new HarnessOrchestrator([
  new ClaudeCodeHarness(),
  new CodexHarness(),
  new OpenCodeHarness(),
  new EveHarness(),
  new MastraHarness(),
]);

export const harnessDescriptors = harnessOrchestrator.listDescriptors();

export function getHarnessDescriptor(harnessId: HarnessId) {
  return harnessOrchestrator.getHarness(harnessId)?.descriptor ?? null;
}

export function buildSandboxRunnerPayload(
  cell: BenchmarkCellRecord,
  task: BenchmarkTask,
  callbackBaseUrl: string,
): SandboxRunnerPayload {
  return harnessOrchestrator
    .requireHarness(cell.harnessId)
    .buildSandboxRunnerPayload(cell, task, callbackBaseUrl);
}

export function buildSandboxEnv(
  cell: BenchmarkCellRecord,
  task: BenchmarkTask,
  callbackBaseUrl: string,
) {
  return harnessOrchestrator.buildSandboxEnv({ cell, task, callbackBaseUrl });
}

export function buildCodexConfig(modelConfig: ModelConfig) {
  return harnessOrchestrator.buildCodexConfig(modelConfig);
}

export function sanitizeForLog(value: string) {
  let output = value;
  for (const [key, secret] of Object.entries(process.env)) {
    if (
      !key.endsWith("_KEY") &&
      !key.endsWith("_TOKEN") &&
      !key.endsWith("_SECRET")
    ) {
      continue;
    }
    if (secret && secret.length > 8) {
      output = output.split(secret).join(`[redacted:${key}]`);
    }
  }
  return output;
}
