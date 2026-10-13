import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
if (process.platform === "darwin") {
  const app = resolve(
    "release",
    process.arch === "arm64" ? "mac-arm64" : "mac",
    "Taskline.app",
  );
  execFileSync("/usr/bin/codesign", ["--force", "--deep", "--sign", "-", app], {
    stdio: "inherit",
  });
  execFileSync(
    "/usr/bin/codesign",
    [
      "--force",
      "--sign",
      "-",
      "--requirements",
      '=designated => identifier \"com.qisoft.taskline\"',
      app,
    ],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
    stdio: "inherit",
  });
  console.log("Taskline app resources sealed and local signature verified.");
}
