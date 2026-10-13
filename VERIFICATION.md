# Verification record

Date: 2026-10-13. Environment: local Apple Silicon macOS, installed `/Applications/Taskline.app`, real T3 Code Nightly `0.0.46-nightly.20261009.2861`, model `codex::gpt-6-luna`.

## Completed checks

| Check                                     | Evidence                                                                                                                                                                                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SQLite and original attachment durability | Six passing focused tests (`npm test`), including reopening storage and comparing original bytes.                                                                                                                                                                                                                                       |
| Project limit and workspace isolation     | The live scheduler test executed four real Luna tasks with limit 2, observed concurrent independent threads, and verified separate worktree paths. `artifacts/live-e2e.json` contains timestamped samples and owned run IDs.                                                                                                            |
| Existing-thread FIFO                      | Real task B began after task A finished in the same thread/workspace and verified the file created by A.                                                                                                                                                                                                                                |
| Results and actual testing output         | All four real scheduler tasks reached Review with structured reports. Each had actual captured test output classified as observed evidence. An initial arithmetic task added multiplication and ran five passing tests.                                                                                                                 |
| Immutable accepted result                 | Accepting a finished card did not mutate the corresponding saved attempt result.                                                                                                                                                                                                                                                        |
| Native installed application              | The signed installed executable launched its bundled UI and local backend, discovered actual T3 projects and registered both native capture accelerators.                                                                                                                                                                               |
| Global capture window                     | The installed app opened its separate native prompt window, created a screenshot task, delivered the image to a real Luna vision turn and returned the result to the correct card.                                                                                                                                                      |
| User questions                            | A fresh Luna request asked for Blue or Green. The task drawer displayed it, sent Blue to T3 and received a result recording Blue.                                                                                                                                                                                                       |
| Epic context and summaries                | Created an epic, froze context v1 in an actual attempt, edited the epic to v2 and generated a real Luna group summary.                                                                                                                                                                                                                  |
| Project settings through the native UI    | Changed the concurrency limit to 3 and disabled automatic execution. A newly created card remained in To Do with zero attempts across a complete restart. The settings dialog showed the persisted values. The fixture card was then cancelled and the original policy restored. `artifacts/project-policy-e2e.json` records the check. |
| Cold restart                              | Task reports, epic context versions and screenshot metadata persisted across quitting and reopening the installed application. The saved attachment bytes were compared before and after restart and matched exactly.                                                                                                                   |
| Build integrity                           | `npm run package` builds the UI, packages Electron, seals the local application signature and passes strict recursive `codesign` verification.                                                                                                                                                                                          |
| Production dependencies                   | `npm audit --omit=dev` reported zero vulnerabilities.                                                                                                                                                                                                                                                                                   |

Five installed desktop scenarios passed together in approximately 1.1 minutes. The additional project-settings scenario passed in a separate installed run after fixing the asynchronous checkbox feedback, bringing the verified desktop scenarios to six. The full suite now contains seven tests; actual display capture remains pending because the macOS session is locked. Generated screenshots are in `artifacts/`; the latest executable test report is in `playwright-report/index.html`.

## Pending native screen verification

The development native overlay previously captured actual 4112 × 2658 screen pixels and cropped a selected region. Final installed-app verification of the entire region → card → T3 → result flow remains pending until the Mac is unlocked. The full desktop suite contains this test; it has not been marked as skipped or passed.

The installed app reports Screen Recording access as granted. A system session check returned `CGSSessionScreenIsLocked = 1`; both development and installed Electron processes returned no screens while the session was locked. Taskline now reports the unavailable/locked screen separately from a missing permission.

Both global accelerators were registered with Electron's OS shortcut API. Native capture windows and their callbacks were exercised. Physical keyboard presses from another application and audio dictation have not been asserted by automation. Dictation uses the user's existing tool or macOS, rather than a Taskline speech-recognition engine.

## Isolation and reproduction

Only the disposable T3 project **Taskline E2E**, rooted at `/Users/qisoft/dev/taskline-e2e`, received agent tasks. User project directories were not modified. The test threads and worktrees remain available as execution evidence. T3's database was not accessed directly.

```sh
cd /Users/qisoft/dev/taskline
npm test
TASKLINE_INSTALLED=1 npm run test:e2e
# With Taskline's backend running:
npm run test:live
```

The tests intentionally launch real agent turns and consume model usage. Run them only with the designated disposable project available. For native region verification, unlock the desktop and allow Taskline Screen Recording access before starting the suite.
