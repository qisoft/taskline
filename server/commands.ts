import type { SpawnOptions } from "node:child_process";
import spawn from "cross-spawn";
export { spawn };

// cross-spawn handles Windows .cmd shims and argument quoting without asking
// callers to construct a shell command (prompts still travel over stdin).
export function runCommand(
  file: string,
  args: string[],
  {
    timeout = 30000,
    maxBuffer = 1024 * 1024,
    ...options
  }: SpawnOptions & { timeout?: number; maxBuffer?: number } = {},
) {
  return new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(file, args, {
      ...options,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "",
      stderr = "",
      settled = false;
    const finish = (error: Error | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve({ stdout, stderr });
    };
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(Object.assign(Error("Command timed out"), { code: "ETIMEDOUT" }));
    }, timeout);
    for (const [stream, name] of [
      [child.stdout, "stdout"],
      [child.stderr, "stderr"],
    ] as const)
      stream?.on("data", (data) => {
        if (name === "stdout") stdout += data;
        else stderr += data;
        if (Buffer.byteLength(stdout) + Buffer.byteLength(stderr) > maxBuffer) {
          child.kill("SIGTERM");
          finish(Error("Command output exceeded its limit"));
        }
      });
    child.once("error", finish);
    child.once("close", (code) =>
      finish(
        code === 0
          ? null
          : Object.assign(
              Error(stderr.trim() || "Command exited with code " + code),
              { code },
            ),
      ),
    );
  });
}
