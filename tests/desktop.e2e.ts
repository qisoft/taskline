import { expect, test } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { registerCaptureScenarios } from "./live-capture-scenarios.js";
import { desktop, launch } from "./live-desktop-fixture.js";
import { registerEpicScenarios } from "./live-epic-scenarios.js";
import { registerPersistenceScenarios } from "./live-persistence-scenarios.js";
test.describe.configure({ mode: "serial" });
test.beforeAll(async () => {
  mkdirSync("artifacts", { recursive: true });
  desktop.app = await launch();
  desktop.window = await desktop.app.firstWindow();
  await expect(desktop.window.locator(".kanban")).toBeVisible();
});
test.afterAll(async () => {
  await desktop.app?.close();
});

registerCaptureScenarios();
registerEpicScenarios();
registerPersistenceScenarios();
