import { build, Platform, Arch } from "electron-builder";
import { resolve } from "node:path";
import { signMac } from "./sign-mac.mjs";
const [platform, flag = "--" + process.arch] = process.argv.slice(2);
if (!["mac", "win"].includes(platform) || !["--arm64", "--x64"].includes(flag))
  throw Error("Usage: node scripts/dist.mjs mac|win --arm64|--x64");
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
    targets: Platform.MAC.createTarget(["dmg", "zip"], arch),
    prepackaged: app,
    publish: "never",
  });
} else {
  await build({
    targets: Platform.WINDOWS.createTarget(["nsis", "zip"], arch),
    publish: "never",
  });
}
