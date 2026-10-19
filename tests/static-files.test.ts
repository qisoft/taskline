import { test } from "node:test";
import assert from "node:assert/strict";
import { posix, win32 } from "node:path";
import { assetPath } from "../server/static-files.js";

for (const [paths, directory] of [
  [posix, "/app/dist"],
  [win32, "C:\\app\\dist"],
] as const) {
  test(`${paths.sep} static assets stay inside the distribution directory`, () => {
    assert.equal(
      assetPath(directory, "/assets/app.js", paths),
      paths.join(directory, "assets", "app.js"),
    );
    assert.equal(
      assetPath(directory, "/assets/app.css", paths),
      paths.join(directory, "assets", "app.css"),
    );
    assert.equal(
      assetPath(directory, "/", paths),
      paths.join(directory, "index.html"),
    );
    assert.equal(assetPath(directory, "/../secret.txt", paths), null);
    assert.equal(assetPath(directory, "/../dist-copy/secret.txt", paths), null);
  });
}
