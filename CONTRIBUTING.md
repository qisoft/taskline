# Contributing to Taskline

Small, focused improvements and reproducible bug reports are welcome. Open an issue before a large change so the intended behavior is clear.

## Run locally

Use Node.js 24+ and `npm ci`. Run `npm run typecheck` for strict TypeScript checks, `npm test` for offline Node tests, and `npm run build` to compile the desktop/server/CLI runtime and web bundle. `npm start` launches Electron. Use `TASKLINE_DATA_DIR` and `TASKLINE_PORT` to keep development data separate from your installed app.

Taskline's SQLite database is independent of T3. Never start a development T3 server against a user's real T3 database or edit that database directly.

## Testing

- Run tests directly related to a change. `npm test` runs unit/API tests with local fixtures and fake providers.
- Packaged smoke tests use `TASKLINE_TEST_APP=/path/to/executable npm run test:e2e -- tests/release-smoke.e2e.mjs` and isolated local state. Use your shell's environment-variable syntax on Windows.
- Native UI fixtures such as `task-planning.e2e.mjs` and `project-cli.e2e.mjs` run without real provider turns.
- `desktop.e2e.mjs` and `scripts/live-e2e.ts` launch real agents, use subscriptions and modify a designated disposable T3 project. Do not run them against personal workspaces or as default CI checks.
- Screen-region checks require an unlocked interactive desktop and, on macOS, Screen Recording permission. Do not equate a headless smoke test with proof of physical global-key dispatch or screen capture.

Preserve thread serialization, project limits, workspace protection, stable attempt IDs, and frozen prompt/context snapshots. Keep observed evidence distinct from model-generated summaries.

## Pull requests

Explain the concrete problem, resulting behavior and checks actually performed. Include a screenshot for visible UI changes. Keep documentation and issue/PR text in English. Run `npm run format:check` before submitting. Never include tokens, local databases, user screenshots or private provider output.

## Releases

Maintainers use matching `v<package version>` tags. The build workflow validates the tag, builds all supported targets and publishes only after every build and smoke test succeeds. Distribution publishing and client self-updates are separate features; Taskline currently supports the former.
