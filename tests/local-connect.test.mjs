import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { startServer } from "../server/index.js";

test("local connection issues a scoped session through the configured native T3 CLI", async () => {
  const directory = mkdtempSync(join(tmpdir(), "taskline-local-connect-"));
  const previous = {
    home: process.env.TASKLINE_T3_HOME,
    cli: process.env.TASKLINE_T3_PATH,
  };
  let runtime;
  try {
    const home = join(directory, "t3");
    mkdirSync(join(home, "userdata"), { recursive: true });
    writeFileSync(
      join(home, "userdata", "server-runtime.json"),
      JSON.stringify({ origin: "http://127.0.0.1:1" }),
    );
    const argsFile = join(directory, "arguments.json");
    const script = join(directory, "fixture.mjs");
    writeFileSync(
      script,
      `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(argsFile)}, JSON.stringify(process.argv.slice(2)));process.stdout.write('fixture-scoped-session');`,
    );
    const command = join(
      directory,
      process.platform === "win32" ? "t3.cmd" : "t3-cli",
    );
    const quote = (text) => "'" + text.replaceAll("'", "'\\''") + "'";
    writeFileSync(
      command,
      process.platform === "win32"
        ? `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`
        : `#!/bin/sh\nexec ${quote(process.execPath)} ${quote(script)} "$@"\n`,
      { mode: 0o755 },
    );
    process.env.TASKLINE_T3_HOME = home;
    process.env.TASKLINE_T3_PATH = command;
    runtime = await startServer({ port: 0, dataDir: join(directory, "data") });
    runtime.scheduler.stop();
    runtime.scheduler.refresh = async () => {};
    runtime.scheduler.signal = () => {};
    assert.deepEqual(await runtime.localConnect(), {
      connected: true,
      origin: "http://127.0.0.1:1",
    });
    const args = JSON.parse(readFileSync(argsFile, "utf8"));
    assert.deepEqual(args.slice(0, 5), [
      "auth",
      "session",
      "issue",
      "--base-dir",
      home,
    ]);
    assert.ok(args.includes("orchestration:operate"));
    assert.equal(args.at(-1), "--token-only");
    assert.equal(runtime.store.config().token, "fixture-scoped-session");
  } finally {
    runtime?.close();
    for (const [name, value] of [
      ["TASKLINE_T3_HOME", previous.home],
      ["TASKLINE_T3_PATH", previous.cli],
    ]) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
