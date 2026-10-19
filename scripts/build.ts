import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";

rmSync("build", { recursive: true, force: true });
execFileSync(
  process.execPath,
  [
    fileURLToPath(
      new URL("../node_modules/typescript/bin/tsc", import.meta.url),
    ),
    "-p",
    "tsconfig.build.json",
  ],
  { stdio: "inherit" },
);
copyFileSync("electron/region.html", "build/electron/region.html");
mkdirSync("build/standalone", { recursive: true });
copyFileSync("build/cli/taskline.js", "build/standalone/taskline.mjs");
copyFileSync(
  "build/scripts/install-cli.js",
  "build/standalone/install-cli.mjs",
);
