import type { BenchmarkCategory, BenchmarkSuite, BenchmarkTask } from "./types";

export const benchmarkSuiteIds: readonly [
  "swe-bench-verified",
  "swe-bench-pro",
  "terminal-bench-2.1",
  "osworld-verified",
  "browsecomp",
  "mcp-atlas",
  "tau2-telecom",
  "finance-agent-v2",
  "vibe-code-bench-1.1",
  "skillsbench",
] = [
  "swe-bench-verified",
  "swe-bench-pro",
  "terminal-bench-2.1",
  "osworld-verified",
  "browsecomp",
  "mcp-atlas",
  "tau2-telecom",
  "finance-agent-v2",
  "vibe-code-bench-1.1",
  "skillsbench",
];

type SuiteSeed = {
  id: (typeof benchmarkSuiteIds)[number];
  name: string;
  category: BenchmarkCategory;
  description: string;
  sourceUrl: string;
  primaryMetric: string;
  licenseNote: string;
};

const suiteSeed: SuiteSeed[] = [
  {
    id: "swe-bench-verified",
    name: "SWE-bench Verified",
    category: "software",
    description:
      "Real GitHub issue resolution tasks with deterministic patch scoring.",
    sourceUrl: "https://www.swebench.com/",
    primaryMetric: "resolved",
    licenseNote:
      "Store task metadata and source references; import full problem assets during operator setup.",
  },
  {
    id: "swe-bench-pro",
    name: "SWE-bench Pro",
    category: "software",
    description:
      "Harder software maintenance tasks for long-horizon coding agents.",
    sourceUrl: "https://www.swebench.com/",
    primaryMetric: "resolved",
    licenseNote:
      "Store task metadata and source references; import full problem assets during operator setup.",
  },
  {
    id: "terminal-bench-2.1",
    name: "Terminal-Bench 2.1",
    category: "terminal",
    description:
      "Terminal-native engineering and systems tasks executed in a shell.",
    sourceUrl: "https://www.tbench.ai/",
    primaryMetric: "pass_rate",
    licenseNote:
      "Use suite IDs and task references by default; import benchmark assets during setup.",
  },
  {
    id: "osworld-verified",
    name: "OSWorld Verified",
    category: "os",
    description: "Computer-use tasks across desktop and web applications.",
    sourceUrl: "https://os-world.github.io/",
    primaryMetric: "success_rate",
    licenseNote:
      "Store metadata and require operator-provided VM/app assets for full execution.",
  },
  {
    id: "browsecomp",
    name: "BrowseComp",
    category: "browser",
    description:
      "Hard browsing tasks that require finding difficult web information.",
    sourceUrl: "https://openai.com/index/browsecomp/",
    primaryMetric: "accuracy",
    licenseNote:
      "Store task references only unless the corpus is explicitly imported by the operator.",
  },
  {
    id: "mcp-atlas",
    name: "MCP Atlas",
    category: "tool-use",
    description:
      "Tool-use tasks across MCP-style connected service environments.",
    sourceUrl: "https://www.vals.ai/benchmarks",
    primaryMetric: "accuracy",
    licenseNote:
      "Store task metadata and adapter hooks; import suite assets during operator setup.",
  },
  {
    id: "tau2-telecom",
    name: "Tau2-bench Telecom",
    category: "tool-use",
    description:
      "Conversational API and policy-adherence tasks in a telecom domain.",
    sourceUrl: "https://github.com/sierra-research/tau2-bench",
    primaryMetric: "success_rate",
    licenseNote:
      "Store task references and replay configuration; import suite assets during setup.",
  },
  {
    id: "finance-agent-v2",
    name: "Finance Agent v2",
    category: "finance",
    description:
      "Finance-oriented agent workflows requiring tool use and evidence handling.",
    sourceUrl: "https://www.vals.ai/benchmarks",
    primaryMetric: "accuracy",
    licenseNote:
      "Store task metadata and require operator-provided benchmark definitions.",
  },
  {
    id: "vibe-code-bench-1.1",
    name: "Vibe Code Bench 1.1",
    category: "software",
    description:
      "Product-building coding tasks scored by project-level outcomes.",
    sourceUrl: "https://www.vals.ai/benchmarks/vibe-code",
    primaryMetric: "score",
    licenseNote:
      "Store task references and import benchmark assets during operator setup.",
  },
  {
    id: "skillsbench",
    name: "SkillsBench",
    category: "skills",
    description:
      "Skill acquisition and instruction-following tasks for agentic harnesses.",
    sourceUrl: "https://www.vals.ai/benchmarks",
    primaryMetric: "score",
    licenseNote:
      "Store task metadata and require operator-provided benchmark definitions.",
  },
];

function makeTasks(suiteId: string, suiteName: string): BenchmarkTask[] {
  return Array.from({ length: 3 }, (_, index) => {
    const ordinal = index + 1;
    return {
      id: `${suiteId}-task-${String(ordinal).padStart(3, "0")}`,
      suiteId,
      title: `${suiteName} seed task ${ordinal}`,
      prompt: [
        `Run ${suiteName} task ${ordinal} using the suite-compatible runner.`,
        "Produce a machine-readable result.json with score, pass/fail, token usage, artifacts, and raw harness output.",
        "If the full benchmark corpus is unavailable, return a failed infrastructure result explaining the missing import instead of fabricating a score.",
      ].join("\n"),
      expectedArtifacts: ["result.json", "harness.log"],
      sourceRef: `${suiteId}:${ordinal}`,
      requiresOperatorImport: true,
    };
  });
}

export const benchmarkSuites: BenchmarkSuite[] = suiteSeed.map((suite) => ({
  ...suite,
  higherIsBetter: true,
  defaultTaskLimit: 3,
  tasks: makeTasks(suite.id, suite.name),
}));

export function getBenchmarkSuite(id: string): BenchmarkSuite | undefined {
  return benchmarkSuites.find((suite) => suite.id === id);
}

export function getBenchmarkTasks(suiteId: string, taskLimit: number) {
  const suite = getBenchmarkSuite(suiteId);
  if (!suite) {
    return [];
  }

  return suite.tasks.slice(0, Math.max(0, taskLimit));
}

export function requireBenchmarkSuite(id: string) {
  const suite = getBenchmarkSuite(id);
  if (!suite) {
    throw new Error(`Unknown benchmark suite: ${id}`);
  }
  return suite;
}
