# Verification record

Date: 2026-10-13. Environment: local Apple Silicon macOS, installed `/Applications/Taskline.app`, real T3 Code Nightly `0.0.46-nightly.20261009.2861`, model `codex::gpt-6-luna`.

## Completed checks

| Check                                     | Evidence                                                                                                                                                                                                                                                                                                                                        |
| ----------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite and original attachment durability | Nine passing focused tests (`npm test`), including reopening storage and comparing original bytes.                                                                                                                                                                                                                                              |
| Project limit and workspace isolation     | The live scheduler test executed four real Luna tasks with limit 2, observed concurrent independent threads, and verified separate worktree paths. `artifacts/live-e2e.json` contains timestamped samples and owned run IDs.                                                                                                                    |
| Existing-thread FIFO                      | Real task B began after task A finished in the same thread/workspace and verified the file created by A.                                                                                                                                                                                                                                        |
| Results and actual testing output         | All four real scheduler tasks reached Review with structured reports. Each had actual captured test output classified as observed evidence. An initial arithmetic task added multiplication and ran five passing tests.                                                                                                                         |
| Immutable accepted result                 | Accepting a finished card did not mutate the corresponding saved attempt result.                                                                                                                                                                                                                                                                |
| Native installed application              | The signed installed executable launched its bundled UI and local backend, discovered actual T3 projects and registered both native capture accelerators.                                                                                                                                                                                       |
| Global capture window                     | The installed app opened its separate native prompt window, created a screenshot task, delivered the image to a real Luna vision turn and returned the result to the correct card.                                                                                                                                                              |
| Actual native region capture              | The installed app captured a real 3440 × 1440 display, selected a region, attached the cropped PNG to a card, launched Luna in an isolated worktree and received an accurate description with TASKLINE-REGION-OK. artifacts/installed-native-e2e.json records the task, thread, workspace, image and report.                                    |
| User questions                            | A fresh Luna request asked for Blue or Green. The task drawer displayed it, sent Blue to T3 and received a result recording Blue.                                                                                                                                                                                                               |
| Epic context and summaries                | Created an epic, froze context v1 in an actual attempt, edited the epic to v2 and generated a real Luna group summary.                                                                                                                                                                                                                          |
| Inline epic creation                      | The native capture form created an epic, selected it automatically, retained the full prompt and input screenshot, and launched a real Luna task with frozen context version 1.                                                                                                                                                                 |
| Agent result screenshots                  | A real Luna turn returned a local screenshot path and an HTTP image URL. Taskline displayed a deduplicated gallery in How it was tested, copied the bytes locally, and preserved them after deleting the worktree image, taking the URL offline and restarting the installed application. `artifacts/result-images-e2e.json` records the proof. |
| Project settings through the native UI    | Changed the concurrency limit to 3 and disabled automatic execution. A newly created card remained in To Do with zero attempts across a complete restart. The settings dialog showed the persisted values. The fixture card was then cancelled and the original policy restored. `artifacts/project-policy-e2e.json` records the check.         |
| Cold restart                              | Task reports, epic context versions and screenshot metadata persisted across quitting and reopening the installed application. The saved attachment bytes were compared before and after restart and matched exactly.                                                                                                                           |
| Build integrity                           | `npm run package` builds the UI, packages Electron, seals the local application signature and passes strict recursive `codesign` verification.                                                                                                                                                                                                  |
| Production dependencies                   | `npm audit --omit=dev` reported zero vulnerabilities.                                                                                                                                                                                                                                                                                           |

The complete installed desktop suite passed all eight tests on 2026-10-13, after the user enabled Screen Recording and unlocked the Mac. Generated screenshots are in `artifacts/`; the executable test report is in `playwright-report/index.html`.

## Native desktop verification

The installed-app region → card → T3 → result flow is verified. The screenshot and its structured report survived a complete application restart, with the original PNG bytes compared before and after restart.

Screen Recording access is granted. The earlier locked-session condition was reproduced: both development and installed Electron processes returned no screens while the macOS session was locked. Taskline reports an unavailable/locked screen separately from a missing permission. The final suite ran on the unlocked console session.

Both global accelerators were registered with Electron's OS shortcut API. Native capture windows and their callbacks were exercised. The user confirmed that both physical cross-application shortcuts work: ⌘⇧1 for text capture and ⌘⇧2 for region capture. ⌘⇧Space was replaced because macOS Apple Visual Intelligence occupied it. UI automation directed at Calculator did not establish OS dispatch; the physical-key confirmation is supplied by the user. Audio dictation is supplied by the user's existing tool or macOS, rather than a Taskline speech-recognition engine. The app's focused text entry and complete text-to-task-to-result path are verified.

## Isolation and reproduction

All agent tasks launched by our verification targeted the disposable T3 project **Taskline E2E**, rooted at `/Users/qisoft/dev/taskline-e2e`. Our verification did not modify user project directories. The user also independently created a normal task in Taskline during development. The test threads and worktrees remain available as execution evidence. T3's database was not accessed directly.

```sh
cd /Users/qisoft/dev/taskline
npm test
TASKLINE_INSTALLED=1 npm run test:e2e
# With Taskline's backend running:
npm run test:live
```

The tests intentionally launch real agent turns and consume model usage. Run them only with the designated disposable project available. For native region verification, unlock the desktop and allow Taskline Screen Recording access before starting the suite.

## In-app image viewer follow-up

The updated installed application passed all three tests in `tests/image-viewer.e2e.ts`. These tests use a separate temporary SQLite database and Electron profile, with no T3 connection or agent execution. They cover card and task attachments, current validation screenshots, attempt history, board and global-capture composers, rendered fit/100% sizing, Escape, backdrop and button closing, keyboard focus, preserved drafts and the absence of external-browser calls.

Only this focused suite was run for the viewer change. The earlier scheduler and real-agent results above remain the baseline; those suites were not rerun.

## Multi-monitor capture follow-up

The old installed application reproduced the reported geometry error: an overlay requested at (0, 0) was placed at (75, 30), the left Dock/menu-bar inset. It also created only one overlay on a two-monitor desktop. The fix allows a frameless window to retain full display bounds and creates a separate source-bound overlay per display.

The updated installed application passed the three capture-only checks in `tests/region-capture.e2e.ts`: full native/content/renderer bounds, selection and exact cropped PNG bytes on both monitors, and Escape/repeated-invocation behavior. The actual displays were 3440×1440 at 1× and 2560×1440 at 2× (5120×2880 pixels). A 120×90-point selection produced 120×90 and 240×180-pixel PNGs respectively. The prompt opened on the selected monitor. No task or agent turn was launched by these tests. Geometry and per-monitor records are in `artifacts/region-*.json`.

## CLI and project-mode follow-up (2026-10-14)

Only directly related checks were run: five passing Node checks in `cli.test.ts`, `project-mode.test.ts` and `project-epics.test.ts`, and the passing installed-native scenario `project-cli.e2e.ts`. They cover stdin/file-backed prompts and image attachments, scoped epics, queued task editing, project policy persistence, pause/admission decisions, reconciliation of running work, other active projects, and CLI/UI mode synchronization. Provider execution is replaced by controlled fixtures; no real agent is launched.

The installed CLI at `/opt/homebrew/bin/taskline` links to the signed application's bundled `Contents/Resources/taskline.mjs`. Its real T3 project-mutation transport was checked, followed by a live CLI planning scenario in a new disposable Git workspace: project creation defaulted to Paused, an epic and two tasks were added, the scheduler persisted `Project is paused` for both, and their attempt lists remained empty. Both fixture cards were cancelled before activating the empty project, then the project was paused again. `artifacts/cli-live-planning.json` records the exact project, epic, tasks and workspace. No live task-execution suites were rerun.

The previously installed project-scoped composer, epic ownership, target-history and cancelled-card changes from the existing worktree were retained in this source checkout and packaged with the CLI.

## Task-level future threads (2026-10-14)

Named execution targets belong to tasks and are independent of epics. `--thread-key` reserves a project-scoped T3 thread ID in SQLite before any execution. The first admitted task creates the thread; later tasks reuse it sequentially. Different keys can execute concurrently within the project limit. Existing and independent-new thread choices remain available, and unstarted queued tasks can be retargeted with the CLI.

The focused Node checks passed in `core.test.ts`, `cli.test.ts`, `project-mode.test.ts`, `project-epics.test.ts`, `thread-targets.test.ts`, `target-history.test.ts` and `composer-defaults.test.ts` (26 checks). Coverage includes parallel/sequential admission, shared workspaces, lost launch response, scheduler restart, persistent reservations across SQLite reopen, pre-launch retry, failed-queue holds, missing/archived thread protection, project scoping, validation, CLI editing and explicit target restoration. T3 execution is replaced by controlled provider fixtures.

The signed packaged build passed `project-cli.e2e.ts` and `thread-targets.e2e.ts`. After installation at `/Applications/Taskline.app`, all nine scenarios in `composer.e2e.ts` and `thread-targets.e2e.ts` passed. The new scenario uses the installed bundled CLI and the actual native composer against an isolated local API/database. It covers two keys within the same epic, reuse from CLI and UI, explicit existing/new targets, task-detail labels before launch, restored selection after restart and the capture composer. No real provider turn or report worker was launched. The normal installed backend remained connected to T3 with the original 71 cards and 15 projects after the update.

## Board access and Dock preference (2026-10-15)

The installed app now registers `CommandOrControl+Shift+0` to open/focus the board and restore it from minimization. Settings exposes the configurable board shortcut and an `Always show Taskline in the Dock` checkbox. Closing the board retains the Dock icon when enabled; disabling it supports menu-bar-only operation. Shortcut conflicts roll back the native registrations and leave persisted settings unchanged.

`npm run package` passed, including the production Vite build and strict recursive local signature verification. `node --check electron/main.cjs`, targeted Prettier checks and `git diff --check` passed. The final installed build passed `TASKLINE_INSTALLED=1 npm run test:e2e -- tests/board-access.e2e.ts` (one comprehensive native scenario, 6.2 seconds). Its isolated SQLite database has no T3 connection or agent tasks. It verifies real OS shortcut registration, conflict rollback, rebinding, the exact registered callback opening a hidden board and restoring a minimized board without duplicate windows, Dock visibility in both directions, rapid toggling, visibility after closing the board, and persistence across full relaunches. Keyboard callback invocation in this fixture is explicit; it does not simulate a physical keyboard press.

The installed test caught Electron's Dock cooldown: an unnecessary startup `dock.show()` caused an immediate subsequent `dock.hide()` to be ignored. The fix avoids redundant visibility calls and honors the documented interval after an actual show. The same originally failing installed scenario passes with the fix, including rapid show/hide. Temporary diagnostic probes were removed.

The application was installed at `/Applications/Taskline.app` and reconnected to the existing T3 environment. Active task attempt IDs remained unchanged across the app update; provider turns continued in T3. No real-agent execution suite was run. A separate CUA interaction sent the default shortcut from Calculator and observed the board window; physical keyboard dispatch has not been independently verified.

## Task priorities and blockers (2026-10-16)

Tasks now store priority and blocker IDs locally. The scheduler and board share the priority ordering (Urgent, High, Normal, Low, No priority), preserving existing rank/creation ordering within a priority. Admission requires every blocker to reach Review or Done, as selected by the user. Blocked tasks do not reserve a slot. Failed, cancelled, paused and missing blockers do not release dependents. Existing running attempts are not interrupted by priority changes. Dependencies can span projects; self-links and cycles are rejected, and referenced blockers cannot be deleted until their links are removed.

The targeted Node command passed 23 checks: `node --test tests/core.test.ts tests/task-planning.test.ts tests/cli.test.ts tests/project-mode.test.ts tests/project-epics.test.ts`. It covers priority admission/non-preemption, blocker lifecycle and multiple prerequisites, shared-thread sequencing after Review, graph validation, deletion guards, legacy defaults, persisted metadata, CLI creation/editing, incremental block/unblock and filtering. Provider calls use the existing FakeT3 fixture; no real provider turn is started.

`npm run package` passed with local signature verification. The signed packaged app passed both `project-cli.e2e.ts` and `task-planning.e2e.ts`. After installation, `TASKLINE_INSTALLED=1 npm run test:e2e -- tests/task-planning.e2e.ts` passed (one integrated native scenario, 4.3 seconds). It uses an isolated local API/database and the installed bundled CLI, covering board/capture creation, priority sorting and editing, adding/removing blockers, navigation in both dependency directions, cycle rejection, live CLI/UI synchronization, Review-based release, retained metadata after relaunch and zero execution attempts. The provider-completion transition is seeded explicitly in that fixture. Generated task-detail evidence was visually inspected.

The installed backend reconnected to T3 and retained all 75 existing cards. Only the related tests above were run; real-agent execution suites were not run. Formatting and `git diff --check` passed.
