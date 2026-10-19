import { Arch, build, Platform } from "electron-builder";
import { copyFileSync } from "node:fs";
import { resolve } from "node:path";
import { asError } from "../shared/errors.js";
import { signMac } from "./sign-mac.js";
const [platform, flag = "--" + process.arch] = process.argv.slice(2);
if (!["mac", "win"].includes(platform) || !["--arm64", "--x64"].includes(flag))
  throw Error("Usage: tsx scripts/dist.ts mac|win --arm64|--x64");
const arch = flag === "--arm64" ? Arch.arm64 : Arch.x64;
if (platform === "mac") {
  if (process.platform !== "darwin")
    throw Error("Build macOS distributions on macOS");
  await build({
    targets: Platform.MAC.createTarget(["dir"], arch),
    publish: "never",
  });
  const app = resolve(
    "release",
    arch === Arch.arm64 ? "mac-arm64" : "mac",
    "Taskline.app",
  );
  signMac(app);
  await build({
    targets: Platform.MAC.createTarget(["zip"], arch),
    prepackaged: app,
    publish: "never",
  });
  // macOS can briefly keep the freshly built volume busy while indexing it.
  // Retry that specific detach failure once; other packaging errors stay fatal.
  for (let attempt = 0; ; attempt++) {
    try {
      await build({
        targets: Platform.MAC.createTarget(["dmg"], arch),
        prepackaged: app,
        publish: "never",
      });
      break;
    } catch (error) {
      if (
        attempt > 0 ||
        !/Resource busy|couldn't eject|Unable to detach/i.test(
          asError(error).message,
        )
      )
        throw error;
      console.warn("DMG volume was busy; retrying packaging once.");
    }
  }
} else {
  await build({
    targets: Platform.WINDOWS.createTarget(["nsis", "zip"], arch),
    publish: "never",
  });
}

for (const name of ["taskline.mjs"])
  copyFileSync("build/standalone/" + name, "release/" + name);
