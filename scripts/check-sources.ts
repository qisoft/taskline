import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";

// Include new, non-ignored files locally as well as files tracked by CI.
const files = [
  ...new Set(
    execFileSync(
      "git",
      ["ls-files", "--cached", "--others", "--exclude-standard", "-z"],
      {
        encoding: "utf8",
      },
    )
      .split("\0")
      .filter((file) => file && existsSync(file)),
  ),
];
const failures: string[] = [];
const decoder = new TextDecoder("utf-8", { fatal: true });
let largest = { file: "", lines: 0 };
for (const file of files) {
  if (/\.(?:[cm]?js|jsx)$/i.test(file))
    failures.push(`${file}: JavaScript sources are forbidden; use TypeScript`);
  // The generated dependency lockfile is the only text-file size exemption.
  if (file === "package-lock.json") continue;
  const bytes = readFileSync(file);
  if (bytes.includes(0)) continue;
  let source: string;
  try {
    source = decoder.decode(bytes);
  } catch {
    continue; // Binary assets have no source lines.
  }
  const lines = source.split("\n").length - Number(source.endsWith("\n"));
  if (lines > largest.lines) largest = { file, lines };
  if (lines > 500)
    failures.push(`${file}: ${lines} lines exceeds the 500-line limit`);
}
if (failures.length) throw Error(failures.join("\n"));
console.log(
  `No JavaScript sources. All text files have at most 500 lines (except package-lock.json). Largest: ${largest.file}, ${largest.lines} lines.`,
);
