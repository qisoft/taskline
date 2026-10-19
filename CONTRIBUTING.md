# Contributing to Taskline

Small, focused improvements and reproducible bug reports are welcome. Open an issue before a large change so the intended behavior is clear.

## Run locally

All source files, including tests, use TypeScript. `npm run check:sources` rejects tracked JavaScript files; build output is ignored. Use Node.js 24+ and `npm ci`. Run `npm run typecheck` for strict TypeScript checks, `npm test` for offline Node tests, and `npm run build` to compile the desktop/server/CLI runtime and web bundle. `npm start` launches Electron. Use `TASKLINE_DATA_DIR` and `TASKLINE_PORT` to keep development data separate from your installed app.

Taskline's SQLite database is independent of T3. Never start a development T3 server against a user's real T3 database or edit that database directly.

## Testing

Use the **Targeted native E2E** GitHub Actions workflow for focused native checks, for example `gh workflow run e2e.yml -f suite=image-viewer -f runner=macos-15-intel`. It builds a signed unpacked app on the selected runner and runs only the chosen fixture.

- Run E2E checks only in GitHub Actions or a separate test environment. Never launch E2E application windows or capture the screen on the developer's computer. Playwright refuses to load outside CI by default. Set `TASKLINE_REMOTE_TEST_ENV=1` only on a separate test machine; never use it or `CI=true` to bypass this restriction locally.
- Run tests directly related to a change. `npm test` runs unit/API tests with local fixtures and fake providers.
- Packaged smoke tests use `TASKLINE_TEST_APP=/path/to/executable npm run test:e2e -- tests/release-smoke.e2e.ts` and isolated local state. Use your shell's environment-variable syntax on Windows.
- Native UI fixtures such as `task-planning.e2e.ts` and `project-cli.e2e.ts` run without real provider turns.
- `desktop.e2e.ts` and `scripts/live-e2e.ts` launch real agents, use subscriptions and modify a designated disposable T3 project. Do not run them against personal workspaces or as default CI checks.
- CI runs the complete macOS native fixture suite with `TASKLINE_CAPTURE_FIXTURE=1`, using deterministic image sources on the runner's displays. Physical multi-monitor capture checks require a separate unlocked test machine and macOS Screen Recording permission. A fixture pass does not prove physical global-key dispatch or capture on another machine.

Preserve thread serialization, project limits, workspace protection, stable attempt IDs, and frozen prompt/context snapshots. Keep observed evidence distinct from model-generated summaries.

## Pull requests

Explain the concrete problem, resulting behavior and checks actually performed. Include a screenshot for visible UI changes. Keep documentation and issue/PR text in English. Run `npm run format:check` before submitting. Never include tokens, local databases, user screenshots or private provider output.

## Releases

Maintainers use matching `v<package version>` tags. The build workflow validates the tag, builds all supported targets and publishes only after every build and smoke test succeeds. Distribution publishing and client self-updates are separate features; Taskline currently supports the former.
