import type { ParseArgsOptionsConfig } from "node:util";
export const priorityLevels = ["urgent", "high", "normal", "low", "none"];
export const options: ParseArgsOptionsConfig = Object.fromEntries(
  [
    "url",
    "project",
    "epic",
    "thread",
    "thread-key",
    "prompt",
    "prompt-file",
    "title",
    "name",
    "path",
    "mode",
    "limit",
    "base",
    "model",
    "provider",
    "context",
    "context-file",
    "criteria",
    "criteria-file",
    "status",
    "priority",
    "request",
    "answers",
    "decision",
    "id",
    "request-id",
  ].map((key) => [key, { type: "string" }]),
);
for (const key of [
  "json",
  "help",
  "paused",
  "active",
  "mkdir",
  "all",
  "blocked",
  "clear-blockers",
  "clear-labels",
])
  options[key] = { type: "boolean" };
options.image = { type: "string", multiple: true };
options["blocked-by"] = { type: "string", multiple: true };
options.by = { type: "string", multiple: true };
for (const key of ["label", "add-label", "remove-label"])
  options[key] = { type: "string", multiple: true };
export const usage = `Taskline — local task board for T3 Code

Usage: taskline <resource> <command> [id] [options]

project list | show [id] | create --name NAME --path DIR [--paused|--active]
project pause [id] | activate [id] | set [id] [--mode paused|active] [--limit N]
project stop [id]   Pause the project and all its epics; stop running tasks.
thread list [--project PROJECT]
model list
epic list [--label LABEL] | show ID | add --name NAME [--project PROJECT] [--context-file FILE] [--paused|--active] [--label LABEL]
epic update ID [--name NAME] [--context TEXT] [--criteria TEXT] [--mode paused|active] [label options]
epic pause ID | activate ID | resume ID
epic summarize ID | close ID | reopen ID | delete ID
task list [--project PROJECT] [--epic EPIC] [--status STATUS] [--priority LEVEL] [--label LABEL] [--blocked] [--all]
task add [--project PROJECT] [--epic EPIC] [--thread ID|new | --thread-key KEY] --prompt TEXT
         [--prompt-file FILE|-] [--title TITLE] [--image FILE] [--model MODEL]
         [--priority urgent|high|normal|low|none] [--blocked-by TASK ...] [--label LABEL]
task show ID | update ID [--title TITLE] [--prompt TEXT] [--epic ID|none] [--thread ID|new | --thread-key KEY]
         [--priority LEVEL] [--blocked-by TASK ... | --clear-blockers] [--status STATUS] [label options]
task block ID --by TASK [--by TASK] | unblock ID --by TASK [--by TASK]
task pause ID | resume ID | cancel ID | accept ID | retry ID | delete ID
task revise ID --prompt TEXT | report ID
task answer ID --request ID --answers '{"question_id":{"answers":["answer"]}}'
task approve ID --request ID --decision DECISION
status | pause | resume | start

Projects default to Paused when created. Activate a project explicitly to execute
its ungrouped queue. Epic modes are independent: an active epic runs even in a
paused project. Project changes affect only ungrouped tasks and the default for
new epics; existing epic modes stay unchanged. Use --paused, --active or --mode
when creating/updating an epic. Global/task pauses still apply; running turns continue.
New threads use separate Git worktrees, so use a Git workspace when creating a project.
Tasks with the same --thread-key in one project share one future thread, created
when the first task starts. They run sequentially, independently of epic membership.
Projects may be addressed by ID, unique name or ID prefix. Task codes TL-ABCD
are accepted when unique. Without --project, the current Git workspace is used.
Use --json for structured output. --prompt-file - reads stdin.
Priority defaults to normal. Higher priorities start first among unblocked tasks.
Repeat --blocked-by to wait for multiple tasks; all must reach Review or Done.
Failed/cancelled tasks remain blockers. Blockers can belong to other projects.
On update, --blocked-by replaces the list; block/unblock adds/removes individual links.
Labels: repeat --label to set/replace the full list; --clear-labels removes all.
Use --add-label / --remove-label on update to change individual labels atomically.
Labels are independent for tasks and epics. Matching ignores case. Repeated --label
on list requires all specified labels. Use up to 20 labels, each 1–64 characters.
Update statuses: todo, review, done, cancelled, failed. Tasks can be moved to Review
or Done without a Taskline execution attempt. Running tasks are controlled by T3;
use cancel to stop them. Moving to todo queues the task under the project's policy.
TASKLINE_URL / --url override http://127.0.0.1:4318. Taskline must be running.
`;
export type CliValues = Partial<
  Record<
    | "url"
    | "project"
    | "epic"
    | "thread"
    | "thread-key"
    | "prompt"
    | "prompt-file"
    | "title"
    | "name"
    | "path"
    | "mode"
    | "limit"
    | "base"
    | "model"
    | "provider"
    | "context"
    | "context-file"
    | "criteria"
    | "criteria-file"
    | "status"
    | "priority"
    | "request"
    | "answers"
    | "decision"
    | "id"
    | "request-id",
    string
  > &
    Record<
      | "json"
      | "help"
      | "paused"
      | "active"
      | "mkdir"
      | "all"
      | "blocked"
      | "clear-blockers"
      | "clear-labels",
      boolean
    > & {
      image: string[];
      "blocked-by": string[];
      by: string[];
      label: string[];
      "add-label": string[];
      "remove-label": string[];
    }
>;
