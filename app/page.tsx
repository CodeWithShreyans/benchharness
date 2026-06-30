import {
  Activity,
  ArrowUpRight,
  Braces,
  Clock3,
  Database,
  Play,
} from "lucide-react";
import { HarnessHeatmap } from "@/components/dashboard/harness-heatmap";
import { LeaderboardTable } from "@/components/dashboard/leaderboard-table";
import { ScoreChart } from "@/components/dashboard/score-chart";
import { StatusBadge } from "@/components/dashboard/status-badge";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { benchmarkSuites } from "@/lib/benchmarks/registry";
import type { HarnessId } from "@/lib/benchmarks/types";
import { getLeaderboard, listRecentCells, listRuns } from "@/lib/db/repository";
import { harnessDescriptors } from "@/lib/harnesses/adapters";
import { formatDuration, formatPercent } from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function Home() {
  const [leaderboard, runs, recentCells] = await Promise.all([
    getLeaderboard(),
    listRuns(),
    listRecentCells(250),
  ]);
  const completedCells = recentCells.filter(
    (cell) => cell.status === "completed",
  );
  const failedCells = recentCells.filter((cell) => cell.status === "failed");
  const infraFailedCells = recentCells.filter(
    (cell) => cell.status === "infra_failed",
  );
  const averageScore =
    completedCells.length > 0
      ? completedCells.reduce((total, cell) => total + (cell.score ?? 0), 0) /
        completedCells.length
      : null;
  const averageDuration =
    completedCells.length > 0
      ? completedCells.reduce(
          (total, cell) => total + (cell.durationMs ?? 0),
          0,
        ) / completedCells.length
      : null;
  const suiteIds = benchmarkSuites.map((suite) => suite.id);
  const harnesses: HarnessId[] = harnessDescriptors.map(
    (harness) => harness.id,
  );

  return (
    <main className="min-h-screen bg-zinc-50 text-zinc-950 dark:bg-zinc-950 dark:text-zinc-50">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 px-4 py-6 sm:px-6 lg:px-8">
        <header className="flex flex-col gap-4 border-b border-zinc-200 pb-6 dark:border-zinc-800 lg:flex-row lg:items-end lg:justify-between">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline">Vercel Sandbox</Badge>
              <Badge variant="secondary">5 harnesses</Badge>
              <Badge variant="secondary">{benchmarkSuites.length} suites</Badge>
            </div>
            <div>
              <h1 className="text-3xl font-semibold tracking-normal sm:text-4xl">
                Agent Benchmark Harness
              </h1>
              <p className="mt-2 max-w-3xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                Public leaderboard for Claude Code, Codex, OpenCode, Eve, and
                Mastra runs across coding, terminal, browser, OS, tool-use,
                finance, and skills benchmarks.
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline">
              <a href="/api/public/leaderboard">
                <Database className="size-4" />
                JSON
              </a>
            </Button>
            <Button asChild>
              <a href="#start-api">
                <Play className="size-4" />
                Start API
              </a>
            </Button>
          </div>
        </header>

        <section className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
          <MetricCard
            icon={<Activity className="size-4" />}
            label="Completed Cells"
            value={completedCells.length.toLocaleString()}
            detail={`${failedCells.length} failed, ${infraFailedCells.length} infra failed`}
          />
          <MetricCard
            icon={<ArrowUpRight className="size-4" />}
            label="Average Score"
            value={formatPercent(averageScore)}
            detail="completed cells"
          />
          <MetricCard
            icon={<Clock3 className="size-4" />}
            label="Average Runtime"
            value={formatDuration(averageDuration)}
            detail="completed cells"
          />
          <MetricCard
            icon={<Braces className="size-4" />}
            label="Recent Runs"
            value={runs.length.toLocaleString()}
            detail="last 50 stored runs"
          />
        </section>

        <section className="grid gap-4 xl:grid-cols-[1.1fr_0.9fr]">
          <Card>
            <CardHeader>
              <CardTitle>Top Scores</CardTitle>
              <CardDescription>
                Highest normalized scores by suite, harness, and model.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ScoreChart rows={leaderboard} />
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Runs</CardTitle>
              <CardDescription>
                Latest run status and cell completion.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {runs.slice(0, 6).map((run) => (
                <div
                  key={run.id}
                  className="flex items-center justify-between gap-3 rounded-md border border-zinc-200 p-3 dark:border-zinc-800"
                >
                  <div className="min-w-0">
                    <div className="truncate font-mono text-xs text-zinc-500">
                      {run.id}
                    </div>
                    <div className="mt-1 text-sm">
                      {run.completedCellCount + run.failedCellCount}/
                      {run.cellCount} cells
                    </div>
                  </div>
                  <StatusBadge status={run.status} />
                </div>
              ))}
            </CardContent>
          </Card>
        </section>

        <Card>
          <CardHeader>
            <CardTitle>Harness Coverage</CardTitle>
            <CardDescription>
              Average score by suite and harness, with sample counts in each
              cell.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <HarnessHeatmap
              rows={leaderboard}
              harnesses={harnesses}
              suiteIds={suiteIds}
            />
          </CardContent>
        </Card>

        <Tabs defaultValue="leaderboard">
          <TabsList>
            <TabsTrigger value="leaderboard">Leaderboard</TabsTrigger>
            <TabsTrigger value="suites">Suites</TabsTrigger>
            <TabsTrigger value="harnesses">Harnesses</TabsTrigger>
            <TabsTrigger value="api">Internal API</TabsTrigger>
          </TabsList>
          <TabsContent value="leaderboard">
            <Card>
              <CardHeader>
                <CardTitle>Leaderboard</CardTitle>
                <CardDescription>
                  Normalized result rows from completed and failed cells.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <LeaderboardTable rows={leaderboard} />
              </CardContent>
            </Card>
          </TabsContent>
          <TabsContent value="suites">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {benchmarkSuites.map((suite) => (
                <Card key={suite.id}>
                  <CardHeader>
                    <CardTitle>{suite.name}</CardTitle>
                    <CardDescription>{suite.description}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      <Badge variant="outline">{suite.category}</Badge>
                      <Badge variant="secondary">{suite.primaryMetric}</Badge>
                    </div>
                    <p className="text-sm leading-6 text-zinc-600 dark:text-zinc-400">
                      {suite.licenseNote}
                    </p>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="harnesses">
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {harnessDescriptors.map((harness) => (
                <Card key={harness.id}>
                  <CardHeader>
                    <CardTitle>{harness.label}</CardTitle>
                    <CardDescription>{harness.summary}</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    <Badge variant="outline">{harness.providerPolicy}</Badge>
                    <div className="font-mono text-sm text-zinc-500">
                      {harness.sdkPackage ?? "Eve project template"}
                    </div>
                  </CardContent>
                </Card>
              ))}
            </div>
          </TabsContent>
          <TabsContent value="api">
            <Card id="start-api">
              <CardHeader>
                <CardTitle>Internal Start Endpoint</CardTitle>
                <CardDescription>
                  Protected by Authorization: Bearer $BENCH_START_SECRET.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <pre className="overflow-x-auto rounded-md border border-zinc-200 bg-zinc-950 p-4 text-xs leading-6 text-zinc-50 dark:border-zinc-800">
                  <code>{startExample}</code>
                </pre>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </main>
  );
}

function MetricCard({
  icon,
  label,
  value,
  detail,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardDescription>{label}</CardDescription>
        <div className="rounded-md border border-zinc-200 p-2 text-zinc-500 dark:border-zinc-800">
          {icon}
        </div>
      </CardHeader>
      <CardContent>
        <div className="text-3xl font-semibold tabular-nums">{value}</div>
        <div className="mt-1 text-sm text-zinc-500">{detail}</div>
      </CardContent>
    </Card>
  );
}

const startExample = `curl -X POST "$APP_URL/api/internal/benchmark-runs" \\
  -H "Authorization: Bearer $BENCH_START_SECRET" \\
  -H "Content-Type: application/json" \\
  -d '{
    "suiteIds": ["swe-bench-verified", "terminal-bench-2.1"],
    "taskLimit": 3,
    "harnesses": ["claude-code", "codex", "opencode", "eve", "mastra"],
    "models": {
      "claude-code": [
        { "id": "opus-4.8-claude-code", "provider": "anthropic", "model": "claude-opus-4-8", "apiKeyEnv": "ANTHROPIC_API_KEY" }
      ],
      "codex": [
        { "id": "gpt-5.5-openai", "codexProviderMode": "openai", "model": "gpt-5.5", "apiKeyEnv": "OPENAI_API_KEY" },
        { "id": "proxy-responses", "codexProviderMode": "responses-compatible", "providerId": "proxy-responses", "model": "gpt-5.5", "baseUrl": "https://proxy.example.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
        { "id": "proxy-chat", "codexProviderMode": "chat-compatible", "providerId": "proxy-chat", "model": "gpt-5.5", "baseUrl": "https://proxy.example.com/v1", "apiKeyEnv": "OPENAI_API_KEY" },
        { "id": "opus-4.8-anthropic-openai-compatible", "provider": "anthropic", "providerId": "anthropic", "codexProviderMode": "chat-compatible", "wireApi": "chat", "model": "claude-opus-4-8", "baseUrl": "https://api.anthropic.com/v1/", "apiKeyEnv": "ANTHROPIC_API_KEY" }
      ],
      "opencode": [
        { "id": "opus-4.8-opencode", "provider": "anthropic", "model": "anthropic/claude-opus-4-8", "apiKeyEnv": "ANTHROPIC_API_KEY" }
      ],
      "eve": [
        { "id": "opus-4.8-eve", "provider": "anthropic", "model": "anthropic/claude-opus-4.8", "apiKeyEnv": "AI_GATEWAY_API_KEY" }
      ],
      "mastra": [
        { "id": "opus-4.8-mastra", "provider": "anthropic", "model": "anthropic/claude-opus-4-8", "apiKeyEnv": "ANTHROPIC_API_KEY" }
      ]
    },
    "maxConcurrency": 10
  }'`;
