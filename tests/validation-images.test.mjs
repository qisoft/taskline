import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { pathToFileURL } from "node:url";
import { createServer } from "node:http";
import { Store } from "../server/store.mjs";
import {
  collectValidationImages,
  imageReferences,
} from "../server/validation-images.mjs";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aV1cAAAAASUVORK5CYII=",
  "base64",
);
const server = async (handler) => {
  const s = createServer(handler);
  await new Promise((r) => s.listen(0, "127.0.0.1", r));
  return {
    origin: "http://127.0.0.1:" + s.address().port,
    close: () =>
      new Promise((r) => {
        s.close(r);
        s.closeAllConnections();
      }),
  };
};
test("extracts image references with spaces and excludes user input and non-image links", () => {
  const refs = imageReferences([
    {
      id: "a",
      type: "assistant",
      text: "![Check](</tmp/proof with spaces.png>) [file](file:///tmp/proof%20two.png) `screenshots/result.webp` https://example.com/check.jpg?x=2 [Docs](https://example.com/docs) [Screenshot](https://example.com/assets/id)",
    },
    { id: "u", type: "user", text: "![Input](/tmp/input.png)" },
  ]);
  assert.deepEqual(
    refs.map((r) => r.reference),
    [
      "/tmp/proof with spaces.png",
      "file:///tmp/proof%20two.png",
      "https://example.com/assets/id",
      "screenshots/result.webp",
      "https://example.com/check.jpg?x=2",
    ],
  );
});
test("copies and deduplicates local and linked images with durable provenance and visible failures", async () => {
  const dir = mkdtempSync(join(tmpdir(), "taskline-images-"));
  let store = new Store(join(dir, "db"));
  const path = join(dir, "proof with spaces.png");
  writeFileSync(path, png);
  const http = await server((req, res) => {
    res.end(req.url === "/bad.png" ? "not an image" : png);
  });
  try {
    const evidence = [
      {
        id: "result",
        type: "assistant",
        text: `![Local](<${path}>) [URL](${http.origin}/proof.png) [Again](${pathToFileURL(path)}) [Encoded](<${path.replaceAll(" ", "%20")}>) [Bad](${http.origin}/bad.png) \`missing.png\` \`input.png\``,
      },
    ];
    const result = await collectValidationImages(store, {
      workspace: dir,
      evidence,
      attachments: [{ name: "input.png" }],
    });
    assert.equal(result.validationImages.length, 1);
    assert.equal(result.validationImages[0].sources.length, 4);
    assert.equal(result.validationImageIssues.length, 2);
    store.put("attempts", { id: "a", ...result });
    rmSync(path);
    await http.close();
    store.close();
    store = new Store(join(dir, "db"));
    const saved = store.get("attempts", "a");
    assert.deepEqual(saved.validationImages, result.validationImages);
    assert.ok(store.image(saved.validationImages[0].id).equals(png));
  } finally {
    await http.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
test("uses the T3 credential only for its exact origin and strips it on external redirects", async () => {
  let externalAuth, internalAuth;
  const outside = await server((req, res) => {
    externalAuth = req.headers.authorization;
    res.end(png);
  });
  const inside = await server((req, res) => {
    internalAuth = req.headers.authorization;
    res.writeHead(302, { location: outside.origin + "/proof.png" });
    res.end();
  });
  const dir = mkdtempSync(join(tmpdir(), "taskline-auth-"));
  const store = new Store(dir);
  try {
    const result = await collectValidationImages(
      store,
      {
        evidence: [
          {
            id: "r",
            type: "assistant",
            text: `![Result](${inside.origin}/proof.png)`,
          },
        ],
      },
      { origin: inside.origin, token: "test-secret" },
    );
    assert.equal(result.validationImages.length, 1);
    assert.equal(internalAuth, "Bearer test-secret");
    assert.equal(externalAuth, undefined);
  } finally {
    await inside.close();
    await outside.close();
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
