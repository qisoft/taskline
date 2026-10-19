import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dataDirectory, toolCandidates } from "../server/platform.mjs";
import { runCommand } from "../server/commands.mjs";
import { installCli } from "../scripts/install-cli.mjs";

test("data and provider locations follow native platform conventions and explicit overrides", () => {
  assert.equal(
    dataDirectory("darwin", "/home/me", {}),
    "/home/me/Library/Application Support/Taskline",
  );
  assert.equal(
    dataDirectory("win32", "C:\\Users\\me", {}),
    "C:\\Users\\me\\AppData\\Roaming\\Taskline",
  );
  assert.equal(
    dataDirectory("win32", "C:\\Users\\me", { APPDATA: "D:\\Profile" }),
    "D:\\Profile\\Taskline",
  );
  assert.equal(
    dataDirectory("linux", "/home/me", { XDG_DATA_HOME: "/data" }),
    "/data/Taskline",
  );
  assert.deepEqual(
    toolCandidates("t3", { platform: "win32", home: "C:\\Users\\me", env: {} }),
    ["C:\\Users\\me\\.t3\\bin\\t3.cmd", "C:\\Users\\me\\.t3\\bin\\t3.exe"],
  );
  assert.deepEqual(
    toolCandidates("codex", { env: { TASKLINE_CODEX_PATH: "/custom/codex" } }),
    ["/custom/codex"],
  );
});
test("provider command execution preserves arguments, errors and timeout boundaries", async () => {
  const args = ["a b", "a&b", 'a"b', "a%b", "a^b"];
  const result = await runCommand(process.execPath, [
    "-e",
    "process.stdout.write(JSON.stringify(process.argv.slice(1)))",
    ...args,
  ]);
  assert.deepEqual(JSON.parse(result.stdout), args);
  await assert.rejects(
    runCommand(process.execPath, [
      "-e",
      "process.stderr.write('fixture failure');process.exit(2)",
    ]),
    /fixture failure/,
  );
  await assert.rejects(
    runCommand(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
      timeout: 50,
    }),
    { code: "ETIMEDOUT" },
  );
});
test("CLI installer creates idempotent commands and refuses to overwrite unrelated files", () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-cli-install-"));
  try {
    const resource = join(directory, "taskline.mjs");
    writeFileSync(resource, "console.log('fixture')\n");
    const bin = join(directory, "bin");
    const target = installCli({ resource, directory: bin, platform: "win32" });
    assert.match(readFileSync(target, "utf8"), /^@echo off\r\nnode "/);
    assert.equal(
      installCli({ resource, directory: bin, platform: "win32" }),
      target,
    );
    writeFileSync(target, "unrelated");
    assert.throws(
      () => installCli({ resource, directory: bin, platform: "win32" }),
      /Refusing/,
    );
    if (process.platform !== "win32") {
      const unix = installCli({ resource, directory: bin, platform: "darwin" });
      assert.equal(
        installCli({ resource, directory: bin, platform: "darwin" }),
        unix,
      );
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
test(
  "Windows .cmd provider shims receive quoted arguments",
  { skip: process.platform !== "win32" },
  async () => {
    const directory = mkdtempSync(join(tmpdir(), "taskline cmd "));
    try {
      const script = join(directory, "echo.mjs"),
        command = join(directory, "provider.cmd");
      writeFileSync(
        script,
        "process.stdout.write(JSON.stringify(process.argv.slice(2)))",
      );
      writeFileSync(
        command,
        '@echo off\r\n"' + process.execPath + '" "' + script + '" %*\r\n',
      );
      const args = ["a b", "a&b", "a%b"];
      const result = await runCommand(command, args);
      assert.deepEqual(JSON.parse(result.stdout), args);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  },
);
