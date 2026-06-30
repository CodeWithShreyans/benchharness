export const harnessIds: readonly [
  "claude-code",
  "codex",
  "opencode",
  "eve",
  "mastra",
] = ["claude-code", "codex", "opencode", "eve", "mastra"];

export type HarnessId = (typeof harnessIds)[number];

export const runStatuses: readonly [
  "queued",
  "running",
  "completed",
  "failed",
  "infra_failed",
  "canceled",
] = ["queued", "running", "completed", "failed", "infra_failed", "canceled"];

export type RunStatus = (typeof runStatuses)[number];

export const cellStatuses: readonly [
  "queued",
  "starting",
  "running",
  "completed",
  "failed",
  "infra_failed",
  "canceled",
] = [
  "queued",
  "starting",
  "running",
  "completed",
  "failed",
  "infra_failed",
  "canceled",
];

export type CellStatus = (typeof cellStatuses)[number];

export const codexProviderModes: readonly [
  "openai",
  "responses-compatible",
  "chat-compatible",
] = ["openai", "responses-compatible", "chat-compatible"];

export type CodexProviderMode = (typeof codexProviderModes)[number];

export const codexWireApis: readonly ["responses", "chat"] = [
  "responses",
  "chat",
];

export type CodexWireApi = (typeof codexWireApis)[number];

export type BenchmarkCategory =
  | "software"
  | "terminal"
  | "os"
  | "browser"
  | "tool-use"
  | "finance"
  | "skills";

export type BenchmarkTask = {
  id: string;
  suiteId: string;
  title: string;
  prompt: string;
  expectedArtifacts: string[];
  sourceRef: string;
  requiresOperatorImport: boolean;
};

export type BenchmarkSuite = {
  id: string;
  name: string;
  category: BenchmarkCategory;
  description: string;
  sourceUrl: string;
  primaryMetric: string;
  higherIsBetter: boolean;
  defaultTaskLimit: number;
  licenseNote: string;
  tasks: BenchmarkTask[];
};

export type TokenUsage = {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
};

export type Artifact = {
  label: string;
  path?: string;
  url?: string;
  kind: "log" | "patch" | "json" | "file" | "screenshot";
};

export type NormalizedResult = {
  score: number | null;
  passed: boolean | null;
  durationMs: number | null;
  tokenUsage: TokenUsage | null;
  costEstimate: number | null;
  logs: string;
  artifacts: Artifact[];
  rawHarnessResult: unknown;
  error?: string;
};

export type ModelConfig = {
  id: string;
  displayName?: string;
  provider?: string;
  providerId?: string;
  model: string;
  baseUrl?: string;
  apiKeyEnv?: string;
  codexProviderMode?: CodexProviderMode;
  wireApi?: CodexWireApi;
};

export type BenchmarkRunRecord = {
  id: string;
  status: RunStatus;
  suiteIds: string[];
  harnesses: HarnessId[];
  taskLimit: number;
  maxConcurrency: number;
  cellCount: number;
  completedCellCount: number;
  failedCellCount: number;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type BenchmarkCellRecord = {
  id: string;
  runId: string;
  suiteId: string;
  suiteName: string;
  taskId: string;
  taskTitle: string;
  harnessId: HarnessId;
  modelId: string;
  modelName: string;
  modelProvider: string | null;
  modelConfig: ModelConfig;
  status: CellStatus;
  sandboxId: string | null;
  commandId: string | null;
  score: number | null;
  passed: boolean | null;
  durationMs: number | null;
  tokenUsage: TokenUsage | null;
  costEstimate: number | null;
  logs: string | null;
  artifacts: Artifact[];
  error: string | null;
  rawHarnessResult: unknown;
  createdAt: string;
  updatedAt: string;
  completedAt: string | null;
};

export type BenchmarkEventRecord = {
  id: string;
  runId: string;
  cellId: string | null;
  type: string;
  message: string;
  payload: unknown;
  createdAt: string;
};

export type LeaderboardRow = {
  suiteId: string;
  suiteName: string;
  harnessId: HarnessId;
  modelId: string;
  modelName: string;
  averageScore: number | null;
  passRate: number | null;
  completedCells: number;
  failedCells: number;
  averageDurationMs: number | null;
  estimatedCost: number | null;
  latestRunId: string | null;
};
