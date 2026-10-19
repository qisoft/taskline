import { execFileSync } from "node:child_process";
const files = execFileSync("git", ["ls-files", "-z"], {
  encoding: "utf8",
}).split("\0");
const javascript = files.filter((file) => /\.(?:[cm]?js|jsx)$/i.test(file));
if (javascript.length)
  throw Error(
    "Tracked JavaScript is not allowed. Use TypeScript sources:\n" +
      javascript.join("\n"),
  );
console.log("No tracked JavaScript files.");
