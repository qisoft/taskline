# Taskline

A local macOS desktop Kanban and global capture window for T3 Code. Taskline stores its own tasks, screenshots, attempts and reports in SQLite. T3 remains responsible for agent execution and workspaces.

## Installed application

Open `/Applications/Taskline.app`. Closing the board hides it; the menu bar icon and global shortcuts remain active. Quit from the Taskline menu to stop the local scheduler. Agent turns already submitted to T3 continue there and are reconciled on the next launch.

- **⌘ ⇧ 1** opens the prompt window above the current application.
- **⌘ ⇧ 2** opens region selection on every connected monitor, including the Dock and menu bar. Drag on the desired monitor; the prompt window opens there with that image attached. Esc cancels selection on all monitors.
- **⌘ Return** submits a task from the capture window.
- **⌘ K** searches the board; **C** opens a new task when a text field is not focused.
- Type, paste or use macOS Dictation / your existing voice typing application in the focused prompt field. Speech recognition is supplied by that tool or macOS; Taskline does not send microphone audio to a separate transcription service.

For screenshots, enable **Taskline** in **System Settings → Privacy & Security → Screen Recording**. The board and Settings provide an “Enable screen recording” button. macOS may request an application restart after changing this permission. No Accessibility permission is needed to register the capture shortcuts.

The capture window offers the live T3 project, existing thread or a new thread, epic and model. Use **New epic** beside the epic selector to create one without leaving the task form; your prompt and attachments are preserved and the new epic is selected automatically. A new thread gets a separate Git worktree. Select an existing thread to queue subsequent tasks in that conversation. Every card retains its original prompt and screenshot.

In Settings, each project has an automatic-start switch, a parallel-task limit and a base branch for new worktrees. Pause the scheduler globally or pause individual To Do tasks when preparing a backlog. Taskline serializes cards targeting the same thread and also protects shared checkout paths from concurrent execution.

The lifecycle is **To Do → In Progress → Review → Done**. T3 completion moves a card to Review. Accept its result to mark it Done, request a revision, retry a failure or stop an active task. Live agent questions and approval requests can be answered in the task drawer. “Open in T3 Code” opens the corresponding conversation.

Epics contain shared context and acceptance criteria. Each attempt freezes the context version it received. Editing the epic affects future attempts. Luna summarizes member task reports into achievements, questions, blockers, testing coverage and next actions. The summary does not override authoritative task statuses.

## Data and connection

Default data directory:

```text
~/Library/Application Support/Taskline/
├── taskline.sqlite         # task, attempt, epic, settings and event records
├── blobs/                  # input attachments and saved result screenshots
├── reports/                # report schema and structured output artifacts
└── connection.json         # T3 origin and scoped access credential, mode 0600
```

The SQLite database uses WAL. Back up the complete directory while Taskline is quit. Keep the connection file private; it is a local protected file, rather than a Keychain entry.

Taskline serves its local API and bundled UI on `http://127.0.0.1:4318`. The desktop app starts that server in-process. “Connect local T3” obtains a scoped session through T3's installed CLI; another T3 environment can be connected with its address and scoped credential. Projects, top-level threads and models come from the live server. Taskline never reads or writes T3's SQLite database directly.

Taskline uses the authenticated T3 V2 orchestration protocol for launching and observing turns, answering requests and uploading attachments. This integration is encapsulated in `server/t3.mjs`; the checked runtime is T3 Code Nightly `0.0.46-nightly.20261009.2861`. Future protocol changes may require adapting that module.

Reports use the locally installed Codex CLI (`/opt/homebrew/bin/codex`) with model `gpt-6-luna`, the user's existing authentication, a read-only sandbox and structured output. Reports and epic summaries require that model to be available. If summarization fails, the original T3 result and evidence remain visible and regeneration is available. Reporting work does not occupy an agent-execution slot.

Testing evidence is labeled **observed output**, **agent reported** or **no evidence**. “Observed output” requires a captured command item with output and an exit code consistent with the stated outcome. The drawer also retains original command output, file changes and attempt history. Click an input attachment or result screenshot to view it inside Taskline. The viewer supports fitting the image to the window, viewing it at 100% and closing with Esc. Screenshots referenced by the agent as local image paths or image links appear in **How it was tested**. Taskline copies them into local storage, retains the original references and keeps each attempt's gallery in its history. Unavailable image references are shown with their retrieval error; an image does not by itself establish that a test passed.

## Development and builds

Use Node with `node:sqlite` support (Node 24+ recommended), npm and the configured T3/Codex environment.

```sh
npm ci
npm run build
npm start
```

For hot reload, run `npm run server` and `npm run dev`, then launch with `TASKLINE_UI_ORIGIN=http://127.0.0.1:4317 npm start`.

```sh
npm run package
ditto release/mac-arm64/Taskline.app /Applications/Taskline.app
```

The package command seals the bundle with a local ad-hoc signature and verifies it. Its explicit designated requirement preserves the application identity across local builds. The app is built for this machine (Apple Silicon), with no notarization or public distribution configured.

Optional environment variables: `TASKLINE_PORT`, `TASKLINE_DATA_DIR`, `TASKLINE_UI_ORIGIN`. The launcher clears inherited `ELECTRON_RUN_AS_NODE`, which would otherwise prevent Electron from starting as a desktop application.

## Verification

```sh
npm test
TASKLINE_INSTALLED=1 npm run test:e2e
npm run test:live
```

The desktop suite operates the installed native Electron application, its prompt and screen-selection windows, local API and real T3 agents. The live scheduler suite uses the disposable **Taskline E2E** T3 project at `/Users/qisoft/dev/taskline-e2e` and GPT-6 Luna. These tests create real threads, worktrees and model usage; they do not touch user project code.

See `VERIFICATION.md` for the recorded results and boundaries. Screenshots and machine-readable execution timelines are in `artifacts/`; the Playwright report is in `playwright-report/`.

## Implementation map

- `electron/`: desktop lifecycle, global shortcuts, capture overlay and native bridge.
- `src/`: React board, task reports, questions, epic context and settings.
- `server/store.mjs`: SQLite and attachment storage.
- `server/t3.mjs`: isolated T3 protocol adapter.
- `server/scheduler.mjs`: durable admission, thread/workspace serialization and reconciliation.
- `server/reports.mjs`: structured Luna interpretation of saved evidence.
- `tests/` and `scripts/live-e2e.mjs`: focused behavior and real desktop/server verification.
