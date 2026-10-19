import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function signMac(app: string) {
  if (process.platform !== "darwin") return;
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
      '=designated => identifier "com.qisoft.taskline"',
      app,
    ],
    { stdio: "inherit" },
  );
  execFileSync("/usr/bin/codesign", ["--verify", "--deep", "--strict", app], {
    stdio: "inherit",
  });
  console.log("Taskline app resources sealed and local signature verified.");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  signMac(
    resolve(
      process.argv[2] ||
        "release/" +
          (process.arch === "arm64" ? "mac-arm64" : "mac") +
          "/Taskline.app",
    ),
  );
