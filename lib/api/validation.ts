import { z } from "zod";
import { benchmarkSuiteIds } from "@/lib/benchmarks/registry";
import {
  type CodexProviderMode,
  type CodexWireApi,
  codexProviderModes,
  codexWireApis,
  harnessIds,
  type ModelConfig,
} from "@/lib/benchmarks/types";
import {
  harnessOrchestrator,
  resolveCodexProviderId,
  resolveCodexProviderMode,
  resolveCodexWireApi,
} from "@/lib/harnesses/adapters";

const modelIdSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[a-zA-Z0-9._:/@+-]+$/);

const envNameSchema = z
  .string()
  .min(1)
  .max(120)
  .regex(/^[A-Z_][A-Z0-9_]*$/);

const providerIdSchema = z
  .string()
  .min(1)
  .max(80)
  .regex(/^[a-zA-Z0-9._-]+$/);

const baseModelSchema = z.object({
  id: modelIdSchema,
  displayName: z.string().min(1).max(160).optional(),
  provider: z.string().min(1).max(80).optional(),
  providerId: providerIdSchema.optional(),
  model: z.string().min(1).max(200),
  baseUrl: z.string().url().optional(),
  apiKeyEnv: envNameSchema.optional(),
  codexProviderMode: z.enum(codexProviderModes).optional(),
  wireApi: z.enum(codexWireApis).optional(),
});

const claudeModelSchema = baseModelSchema.extend({
  provider: z.literal("anthropic").default("anthropic"),
});

type CodexModelValidationInput = {
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

const codexModelSchema = baseModelSchema
  .superRefine((model, context) => {
    const providerMode = resolveCodexProviderMode(model);
    const wireApi = resolveCodexWireApi(model);

    if (providerMode === "openai" && model.baseUrl) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message:
          "OpenAI Codex mode must not include baseUrl. Use responses-compatible or chat-compatible for custom endpoints.",
      });
    }

    if (
      providerMode === "openai" &&
      model.providerId &&
      model.providerId !== "openai"
    ) {
      context.addIssue({
        code: "custom",
        path: ["providerId"],
        message:
          "OpenAI Codex mode must use providerId 'openai' or omit providerId.",
      });
    }

    if (providerMode !== "openai" && !model.baseUrl) {
      context.addIssue({
        code: "custom",
        path: ["baseUrl"],
        message: "OpenAI-compatible Codex provider modes require a baseUrl.",
      });
    }

    if (providerMode === "responses-compatible" && wireApi !== "responses") {
      context.addIssue({
        code: "custom",
        path: ["wireApi"],
        message:
          "responses-compatible Codex mode must use wireApi 'responses'.",
      });
    }

    if (providerMode === "chat-compatible" && wireApi !== "chat") {
      context.addIssue({
        code: "custom",
        path: ["wireApi"],
        message: "chat-compatible Codex mode must use wireApi 'chat'.",
      });
    }
  })
  .transform((model: CodexModelValidationInput): ModelConfig => {
    const codexProviderMode = resolveCodexProviderMode(model);
    return {
      ...model,
      providerId: resolveCodexProviderId(model, codexProviderMode),
      codexProviderMode,
      wireApi: resolveCodexWireApi(model),
    };
  });

const harnessSchema = z.enum(harnessIds);

export const startBenchmarkRunSchema = z.object({
  suiteIds: z
    .array(z.enum(benchmarkSuiteIds))
    .min(1)
    .max(benchmarkSuiteIds.length),
  taskLimit: z.number().int().min(1).max(200).default(3),
  harnesses: z.array(harnessSchema).min(1).max(harnessIds.length),
  models: z.object({
    "claude-code": z.array(claudeModelSchema).optional(),
    codex: z.array(codexModelSchema).optional(),
    opencode: z.array(baseModelSchema).optional(),
    eve: z.array(baseModelSchema).optional(),
    mastra: z.array(baseModelSchema).optional(),
  }),
  maxConcurrency: z.number().int().min(1).max(50).default(10),
});

export const benchmarkEventSchema = z.object({
  runId: z.string().uuid(),
  cellId: z.string().uuid().optional(),
  type: z.string().min(1).max(80),
  message: z.string().min(1).max(1000),
  payload: z.unknown().optional(),
});

export const completeCellSchema = z.object({
  status: z.enum(["completed", "failed", "infra_failed"]),
  score: z.number().min(0).max(100).nullable().optional(),
  passed: z.boolean().nullable().optional(),
  durationMs: z.number().int().min(0).nullable().optional(),
  tokenUsage: z
    .object({
      input: z.number().int().min(0).optional(),
      output: z.number().int().min(0).optional(),
      cacheRead: z.number().int().min(0).optional(),
      cacheWrite: z.number().int().min(0).optional(),
    })
    .nullable()
    .optional(),
  costEstimate: z.number().min(0).nullable().optional(),
  logs: z.string().max(500_000).default(""),
  artifacts: z
    .array(
      z.object({
        label: z.string().min(1).max(160),
        path: z.string().max(500).optional(),
        url: z.string().url().optional(),
        kind: z.enum(["log", "patch", "json", "file", "screenshot"]),
      }),
    )
    .default([]),
  rawHarnessResult: z.unknown().optional(),
  error: z.string().max(5000).optional(),
});

export type StartBenchmarkRunInput = z.infer<typeof startBenchmarkRunSchema>;
export type BenchmarkEventInput = z.infer<typeof benchmarkEventSchema>;
export type CompleteCellInput = z.infer<typeof completeCellSchema>;

export function validateModelMatrix(input: StartBenchmarkRunInput) {
  const errors: string[] = [];

  for (const harness of input.harnesses) {
    const models = input.models[harness] ?? [];
    if (models.length === 0) {
      errors.push(`No models provided for harness '${harness}'.`);
    }
  }

  for (const harness of harnessIds) {
    const models = input.models[harness] ?? [];
    for (const model of models ?? []) {
      errors.push(...harnessOrchestrator.validateModelConfig(harness, model));

      if (model.apiKeyEnv && !process.env[model.apiKeyEnv]) {
        errors.push(
          `${harness} model '${model.id}' references missing env var '${model.apiKeyEnv}'.`,
        );
      }
    }
  }

  return errors;
}
