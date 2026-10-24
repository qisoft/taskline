import { spawn } from "node:child_process";
import { resolve } from "node:path";

const cli = resolve("build/standalone/taskline.mjs");
export function run(
  args: string[],
  origin: string,
  input = "",
  cwd = process.cwd(),
  json = true,
) {
  return new Promise<{
    code: number | null;
    out: string;
    err: string;
    data: ReturnType<typeof JSON.parse>;
  }>((resolve) => {
    const child = spawn(
      process.execPath,
      [cli, ...args, ...(json ? ["--json"] : [])],
      {
        cwd,
        env: { ...process.env, TASKLINE_URL: origin },
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    let out = "",
      err = "";
    child.stdout.on("data", (c) => (out += c));
    child.stderr.on("data", (c) => (err += c));
    child.stdin.end(input);
    child.on("close", (code) =>
      resolve({
        code,
        out,
        err,
        data: code === 0 && json ? JSON.parse(out) : null,
      }),
    );
  });
}
