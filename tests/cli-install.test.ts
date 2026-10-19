import { test } from "node:test";
import assert from "node:assert/strict";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
  symlinkSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { installCli, installDesktopCli } from "../electron/cli-install.js";

function fixture() {
  const home = mkdtempSync(join(tmpdir(), "taskline cli's home "));
  const resource = join(home, "cli with spaces.mjs");
  writeFileSync(resource, "console.log(JSON.stringify(process.argv.slice(2)))");
  return {
    home,
    resource,
    close: () => rmSync(home, { recursive: true, force: true }),
  };
}

test(
  "desktop CLI installs into a private home, preserves shell settings and works from a fresh shell without node on PATH",
  { skip: process.platform === "win32" },
  () => {
    const f = fixture();
    try {
      writeFileSync(
        join(f.home, ".profile"),
        "export EXISTING_SETTING=preserved\n",
      );
      const options = {
        resource: f.resource,
        runtime: process.execPath,
        home: f.home,
        platform: "linux" as const,
        env: { SHELL: "/bin/sh" },
      };
      const first = installDesktopCli(options);
      const profile = readFileSync(join(f.home, ".profile"), "utf8");
      assert.equal(installDesktopCli(options).path, first.path);
      assert.equal(readFileSync(join(f.home, ".profile"), "utf8"), profile);
      assert.match(profile, /^export EXISTING_SETTING=preserved/);
      const stdout = execFileSync(
        "/bin/sh",
        [
          "-c",
          '. "$HOME/.profile"; test "$EXISTING_SETTING" = preserved && taskline "two words" \'literal $value\'',
        ],
        { encoding: "utf8", env: { HOME: f.home, PATH: "/usr/bin:/bin" } },
      );
      assert.deepEqual(JSON.parse(stdout), ["two words", "literal $value"]);
      assert.match(readFileSync(first.path, "utf8"), /ELECTRON_RUN_AS_NODE=1/);
      const updatedResource = join(f.home, "updated.mjs");
      writeFileSync(updatedResource, "console.log('updated')");
      installDesktopCli({ ...options, resource: updatedResource });
      assert.equal(
        execFileSync(first.path, [], { encoding: "utf8" }).trim(),
        "updated",
      );
    } finally {
      f.close();
    }
  },
);

test("zsh registers login and interactive shells without duplicating PATH blocks", () => {
  const f = fixture();
  try {
    const options = {
      resource: f.resource,
      runtime: process.execPath,
      home: f.home,
      platform: "darwin" as const,
      env: { SHELL: "/bin/zsh", ZDOTDIR: join(f.home, "zsh") },
    };
    installDesktopCli(options);
    installDesktopCli(options);
    for (const name of [".zprofile", ".zshrc"]) {
      const text = readFileSync(join(f.home, "zsh", name), "utf8");
      assert.equal(text.match(/# >>> Taskline CLI >>>/g)?.length, 1);
      assert.ok(text.includes(".local"));
    }
  } finally {
    f.close();
  }
});

test("bash preserves an existing login profile and fish receives its native PATH configuration", () => {
  const f = fixture();
  try {
    writeFileSync(join(f.home, ".bash_login"), "# Existing login settings\n");
    installDesktopCli({
      resource: f.resource,
      runtime: process.execPath,
      home: f.home,
      platform: "linux",
      env: { SHELL: "/bin/bash" },
    });
    assert.match(
      readFileSync(join(f.home, ".bash_login"), "utf8"),
      /^# Existing login settings/,
    );
    assert.match(readFileSync(join(f.home, ".bashrc"), "utf8"), /Taskline CLI/);
    installDesktopCli({
      resource: f.resource,
      runtime: process.execPath,
      home: f.home,
      platform: "linux",
      env: { SHELL: "/usr/bin/fish" },
    });
    assert.match(
      readFileSync(
        join(f.home, ".config", "fish", "conf.d", "taskline.fish"),
        "utf8",
      ),
      /fish_add_path --prepend/,
    );
  } finally {
    f.close();
  }
});

test("Windows installs a per-user command, quotes its runtime and registers user PATH", () => {
  const f = fixture();
  try {
    const registered: string[] = [];
    const installed = installDesktopCli({
      resource: f.resource,
      runtime: "C:\\Program Files\\Taskline!\\Taskline.exe",
      home: f.home,
      platform: "win32",
      env: { LOCALAPPDATA: f.home },
      registerWindowsPath: (directory) => registered.push(directory),
    });
    assert.deepEqual(registered, [join(f.home, "Taskline", "bin")]);
    const shim = readFileSync(installed.path, "utf8");
    assert.match(shim, /setlocal DisableDelayedExpansion/);
    assert.match(shim, /set "ELECTRON_RUN_AS_NODE=1"/);
    assert.ok(shim.includes('"C:\\Program Files\\Taskline!\\Taskline.exe"'));
  } finally {
    f.close();
  }
});

test("automatic installation never overwrites an unrelated command or edits shell configuration on conflict", () => {
  const f = fixture();
  try {
    const bin = join(f.home, ".local", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(join(bin, "taskline"), "unrelated command");
    assert.throws(
      () =>
        installDesktopCli({
          resource: f.resource,
          runtime: process.execPath,
          home: f.home,
          platform: "darwin",
          env: { SHELL: "/bin/zsh" },
        }),
      /Refusing/,
    );
    assert.equal(
      readFileSync(join(bin, "taskline"), "utf8"),
      "unrelated command",
    );
    assert.throws(() => readFileSync(join(f.home, ".zshrc")), /ENOENT/);
  } finally {
    f.close();
  }
});

test(
  "a previous Taskline symlink upgrades to a managed command",
  { skip: process.platform === "win32" },
  () => {
    const f = fixture();
    try {
      const bin = join(f.home, "bin");
      mkdirSync(bin);
      symlinkSync(f.resource, join(bin, "taskline"));
      const target = installCli({
        resource: f.resource,
        directory: bin,
        runtime: process.execPath,
      });
      assert.match(readFileSync(target, "utf8"), /Taskline managed CLI/);
    } finally {
      f.close();
    }
  },
);

test("a previous Windows Node shim upgrades to the bundled runtime", () => {
  const f = fixture();
  try {
    const bin = join(f.home, "bin");
    mkdirSync(bin);
    const target = join(bin, "taskline.cmd");
    writeFileSync(
      target,
      '@echo off\r\nnode "' + f.resource.replaceAll("%", "%%") + '" %*\r\n',
    );
    installCli({
      resource: f.resource,
      directory: bin,
      platform: "win32",
      runtime: "Taskline.exe",
      runAsNode: true,
    });
    assert.match(readFileSync(target, "utf8"), /ELECTRON_RUN_AS_NODE=1/);
  } finally {
    f.close();
  }
});
