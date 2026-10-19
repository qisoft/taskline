import { readFileSync } from "node:fs";
const { version } = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url)),
);
const tag =
  process.argv[2] ||
  (process.env.GITHUB_REF_TYPE === "tag" ? process.env.GITHUB_REF_NAME : null);
if (tag && tag !== "v" + version)
  throw Error(`Tag ${tag} does not match package version v${version}`);
console.log(
  tag ? "Release version verified: " + tag : "Package version: " + version,
);
