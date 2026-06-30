import { z } from "zod";
import { getBenchmarkSuite } from "@/lib/benchmarks/registry";
import type { BenchmarkCellRecord } from "@/lib/benchmarks/types";
import { harnessOrchestrator } from "@/lib/harnesses/adapters";

const sandboxCreateResponseSchema = z.object({
  id: z.string().optional(),
  sessionId: z.string().optional(),
  session: z.object({ id: z.string().optional() }).optional(),
});

const sandboxCommandResponseSchema = z.object({
  id: z.string().optional(),
  cmdId: z.string().optional(),
  commandId: z.string().optional(),
});

const vercelErrorResponseSchema = z.object({
  error: z.object({ message: z.string().optional() }).optional(),
});

type DispatchResult =
  | { ok: true; sandboxId: string; commandId: string | null }
  | { ok: false; reason: string };

type VercelAuth = {
  oidcToken?: string | null;
};

function sandboxApiUrl(path: string) {
  const url = new URL(`https://api.vercel.com${path}`);
  if (process.env.VERCEL_TEAM_ID) {
    url.searchParams.set("teamId", process.env.VERCEL_TEAM_ID);
  }
  return url.toString();
}

function configuredCallbackBaseUrl() {
  if (process.env.BENCH_CALLBACK_BASE_URL) {
    return process.env.BENCH_CALLBACK_BASE_URL;
  }

  if (process.env.VERCEL_URL) {
    return `https://${process.env.VERCEL_URL}`;
  }

  return "http://localhost:3000";
}

export function getSandboxConfigurationIssue() {
  if (!process.env.VERCEL_SANDBOX_SOURCE_URL) {
    return "VERCEL_SANDBOX_SOURCE_URL is not configured.";
  }

  return null;
}

export function getVercelOidcToken(request: Request) {
  return request.headers.get("x-vercel-oidc-token");
}

function getVercelAuthToken(auth?: VercelAuth) {
  return (
    auth?.oidcToken ??
    process.env.VERCEL_OIDC_TOKEN ??
    process.env.VERCEL_API_TOKEN ??
    null
  );
}

async function vercelFetch(path: string, init: RequestInit, auth?: VercelAuth) {
  const token = getVercelAuthToken(auth);
  if (!token) {
    throw new Error(
      "Vercel auth is not available. Deploy on Vercel for injected OIDC auth, or set VERCEL_API_TOKEN locally.",
    );
  }

  const response = await fetch(sandboxApiUrl(path), {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      ...init.headers,
    },
  });

  const payload: unknown = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(
      vercelErrorResponseSchema.safeParse(payload).data?.error?.message ??
        `Vercel Sandbox request failed with ${response.status}.`,
    );
  }

  return payload;
}

export async function dispatchCellToSandbox(
  cell: BenchmarkCellRecord,
  auth?: VercelAuth,
): Promise<DispatchResult> {
  const configurationIssue = getSandboxConfigurationIssue();
  if (configurationIssue) {
    return { ok: false, reason: configurationIssue };
  }

  const suite = getBenchmarkSuite(cell.suiteId);
  const task = suite?.tasks.find((candidate) => candidate.id === cell.taskId);
  if (!suite || !task) {
    return {
      ok: false,
      reason: `Unknown task ${cell.suiteId}/${cell.taskId}.`,
    };
  }

  const callbackBaseUrl = configuredCallbackBaseUrl();
  const name = [
    "bench",
    cell.runId.slice(0, 8),
    cell.id.slice(0, 8),
    cell.harnessId,
  ].join("-");

  const sandbox = sandboxCreateResponseSchema.parse(
    await vercelFetch(
      "/v2/sandboxes",
      {
        method: "POST",
        body: JSON.stringify({
          name,
          runtime: "node24",
          persistent: false,
          timeout: 3600000,
          resources: { vcpus: 2, memory: 4096 },
          source: {
            type: "git",
            url: process.env.VERCEL_SANDBOX_SOURCE_URL,
            depth: 1,
            revision: process.env.VERCEL_SANDBOX_SOURCE_REVISION ?? "main",
          },
          projectId: process.env.VERCEL_PROJECT_ID,
          tags: {
            app: "benchharness",
            runId: cell.runId,
            cellId: cell.id,
            harness: cell.harnessId,
          },
        }),
      },
      auth,
    ),
  );

  const sandboxId = sandbox.sessionId ?? sandbox.session?.id ?? sandbox.id;
  if (!sandboxId) {
    return { ok: false, reason: "Vercel Sandbox did not return a session id." };
  }

  const commandPlan = harnessOrchestrator.buildSandboxCommand({
    cell,
    task,
    callbackBaseUrl,
  });

  const command = sandboxCommandResponseSchema.parse(
    await vercelFetch(
      `/v2/sandboxes/sessions/${sandboxId}/cmd`,
      {
        method: "POST",
        body: JSON.stringify(commandPlan),
      },
      auth,
    ),
  );

  return {
    ok: true,
    sandboxId,
    commandId: command.cmdId ?? command.commandId ?? command.id ?? null,
  };
}
