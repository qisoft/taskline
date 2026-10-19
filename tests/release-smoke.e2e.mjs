import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);

test("packaged app boots its own isolated SQLite backend and ships a working CLI", async () => {
  const executable = process.env.TASKLINE_TEST_APP;
  if (!executable)
    throw Error("Set TASKLINE_TEST_APP to a packaged executable");
  const directory = mkdtempSync(join(tmpdir(), "taskline-release-"));
  const listener = createServer();
  await new Promise((resolve) => listener.listen(0, "127.0.0.1", resolve));
  const port = listener.address().port;
  await new Promise((resolve) => listener.close(resolve));
  const env = {
    ...process.env,
    TASKLINE_E2E: "1",
    TASKLINE_DATA_DIR: directory,
    TASKLINE_PORT: String(port),
  };
  delete env.ELECTRON_RUN_AS_NODE;
  delete env.TASKLINE_UI_ORIGIN;
  let app;
  try {
    app = await electron.launch({
      executablePath: resolve(executable),
      args: ["--user-data-dir=" + join(directory, "electron")],
      env,
    });
    const page = await app.firstWindow();
    const origin = "http://127.0.0.1:" + port;
    const index = await (await page.request.get(origin)).text();
    const assets = [
      ...index.matchAll(/(?:src|href)="([^\"]+\.(?:js|css))"/g),
    ].map((match) => match[1]);
    expect(assets.length).toBeGreaterThanOrEqual(2);
    for (const asset of assets) {
      const response = await page.request.get(new URL(asset, origin).href);
      expect(response.ok()).toBe(true);
      expect(response.headers()["content-type"]).toContain(
        asset.endsWith(".js") ? "javascript" : "css",
      );
    }
    await expect(page.locator(".kanban")).toBeVisible();
    expect(await app.evaluate(({ app }) => app.isPackaged)).toBe(true);
    const info = await page.evaluate(() => window.taskline.desktopInfo());
    expect(info.platform).toBe(process.platform);
    expect(info.dataDir).toBe(directory);
    const resources =
      process.platform === "darwin"
        ? resolve(dirname(executable), "../Resources")
        : join(dirname(executable), "resources");
    const result = await exec(
      process.execPath,
      [join(resources, "taskline.mjs"), "status", "--json"],
      { env: { ...process.env, TASKLINE_URL: "http://127.0.0.1:" + port } },
    );
    expect(JSON.parse(result.stdout)).toMatchObject({
      connected: false,
      tasks: 0,
      activeTasks: 0,
    });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(
      page.getByRole("dialog", { name: "Settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByLabel("Board shortcut", { exact: true }),
    ).toHaveValue("CommandOrControl+Shift+0");
    if (process.platform === "win32")
      await expect(
        page.getByLabel("Always show Taskline in the Dock"),
      ).toHaveCount(0);
  } finally {
    if (app) {
      const child = app.process();
      await app.close().catch(() => child.kill());
    }
    rmSync(directory, { recursive: true, force: true });
  }
});
