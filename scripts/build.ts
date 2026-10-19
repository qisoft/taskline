import { execFileSync } from "node:child_process";
import { copyFileSync, mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { build } from "vite";

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
await build({
  configFile: false,
  build: {
    ssr: "cli/taskline.ts",
    outDir: "build/standalone",
    emptyOutDir: false,
    minify: false,
    target: "node24",
    rolldownOptions: { output: { entryFileNames: "taskline.mjs" } },
  },
});
