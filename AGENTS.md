# Taskline contributor notes

Taskline is a separate application. Do not modify T3 Code's application database. Use the scoped T3 HTTP/WebSocket orchestration adapter in `server/t3.ts`.

Keep raw execution evidence and authoritative task state separate from model-generated interpretations. A command is observed evidence only when its actual output and exit code were obtained for the owned turn. Epics and future prompts may change; attempt prompt snapshots must retain their original context version.

Preserve thread serialization, project limits, workspace protection and durable command/message IDs when changing the scheduler. Do not release an execution slot because a report worker finished or because a parent turn still has child work.

Run only checks that directly cover the change. Do not run suites that launch T3 agent tasks for UI-only changes unless explicitly requested. Image viewing uses the isolated local fixture in `tests/image-viewer.e2e.mjs`; run `TASKLINE_INSTALLED=1 npm run test:e2e -- tests/image-viewer.e2e.mjs`. Use targeted Node tests for scheduler/storage changes. The real-agent tests may only use the disposable Taskline E2E project and GPT-6 Luna unless the user authorizes another target.

Run `npm run package` before installing a new build. It applies and verifies the local application signature. Do not claim a packaged application was tested when only the development Electron process was launched.

Keep repository documentation in English. Never commit local credentials, databases, screenshots of unrelated user activity or generated report artifacts.

For CLI/project-mode changes, run `node --import tsx --test tests/cli.test.mjs tests/project-mode.test.mjs tests/project-epics.test.mjs` and the targeted `tests/project-cli.e2e.mjs` native scenario. These use local fixtures and do not launch real provider turns. Package the bundled CLI together with the desktop app, and install its link with `npm run install:cli`. Preserve the project-scoped composer/epic selection and target-history helpers when building from this checkout.
