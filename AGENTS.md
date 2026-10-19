# Taskline contributor notes

Taskline is a separate application. Do not modify T3 Code's application database. Use the scoped T3 HTTP/WebSocket orchestration adapter in `server/t3.ts`.

Keep raw execution evidence and authoritative task state separate from model-generated interpretations. A command is observed evidence only when its actual output and exit code were obtained for the owned turn. Epics and future prompts may change; attempt prompt snapshots must retain their original context version.

Preserve thread serialization, project limits, workspace protection and durable command/message IDs when changing the scheduler. Do not release an execution slot because a report worker finished or because a parent turn still has child work.

Run only checks that directly cover the change. Never run E2E tests, launch test application windows, or capture the screen on the developer's computer. Run E2E checks in GitHub Actions or a separate test environment. This applies to all native UI and screen-capture fixtures, including tests that use isolated databases and fake providers. Local type checks, builds and non-UI unit/API tests are allowed. Never set `CI=true` or `TASKLINE_REMOTE_TEST_ENV=1` on the developer's computer to bypass the Playwright guard. Real-agent tests require explicit authorization for a disposable test environment; never run them against personal workspaces.

Run `npm run package` before installing a new build. It applies and verifies the local application signature. Do not claim a packaged application was tested when only the development Electron process was launched.

Keep repository documentation in English. Never commit local credentials, databases, screenshots of unrelated user activity or generated report artifacts.

For CLI/project-mode changes, run `node --import tsx --test tests/cli.test.ts tests/project-mode.test.ts tests/project-epics.test.ts` and the targeted `tests/project-cli.e2e.ts` native scenario in CI or a separate test environment. These use local fixtures and do not launch real provider turns. The packaged app installs the bundled CLI automatically. `npm run install:cli` is a manual development installation that changes shell startup files or user PATH; do not run it during tests. Preserve the project-scoped composer/epic selection and target-history helpers when building from this checkout.

Keep every source, test, stylesheet and other text file at or below 500 lines, including comments and blank lines. Only the generated `package-lock.json` is exempt. Split code at feature or responsibility boundaries. Run `npm run check:sources`, `npm run lint` (Oxlint) and `npm run format:check` (Oxfmt) before pushing. Use `npm run format` to format changes.
