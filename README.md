# Benchharness

Public agent benchmark dashboard with an internal API for launching model x harness x task runs in Vercel Sandboxes.

## Development

```bash
bun install
bun run dev
```

Open `http://localhost:3000`.

## Live Runs

Required environment:

```bash
TURSO_DATABASE_URL=
TURSO_AUTH_TOKEN=
BENCH_START_SECRET=
VERCEL_SANDBOX_SOURCE_URL=
BENCH_CALLBACK_BASE_URL=
```

Sandbox dispatch uses Vercel-injected OIDC auth in deployed functions. Set `VERCEL_API_TOKEN` only for local sandbox dispatch.

Optional environment:

```bash
VERCEL_SANDBOX_SOURCE_REVISION=main
VERCEL_TEAM_ID=
VERCEL_PROJECT_ID=
ANTHROPIC_API_KEY=
OPENAI_API_KEY=
```

Codex model configs support three provider modes:

```json
{ "id": "gpt-5.5-openai", "codexProviderMode": "openai", "model": "gpt-5.5", "apiKeyEnv": "OPENAI_API_KEY" }
{ "id": "proxy-responses", "codexProviderMode": "responses-compatible", "providerId": "proxy-responses", "model": "gpt-5.5", "baseUrl": "https://proxy.example.com/v1", "apiKeyEnv": "PROXY_API_KEY" }
{ "id": "proxy-chat", "codexProviderMode": "chat-compatible", "providerId": "proxy-chat", "model": "gpt-5.5", "baseUrl": "https://proxy.example.com/v1", "apiKeyEnv": "PROXY_API_KEY" }
```

`wireApi` remains accepted for compatibility; `codexProviderMode` is the preferred field. Codex currently notes that Chat Completions compatibility is deprecated, so use `chat-compatible` only for providers that do not expose the Responses API.

Run database migrations:

```bash
bun run db:migrate
```

Start a run:

```bash
curl -X POST "$APP_URL/api/internal/benchmark-runs" \
  -H "Authorization: Bearer $BENCH_START_SECRET" \
  -H "Content-Type: application/json" \
  -d @run.json
```

Benchmark task assets should be placed under `benchmarks/<suiteId>/<taskId>.json`. Without imported task assets, cells fail intentionally instead of fabricating scores.

## Verification

```bash
bun run lint
bun run build
```
