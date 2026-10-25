import assert from "node:assert/strict";
import { test } from "node:test";
import {
  availableLabels,
  labelPatch,
  labelDelta,
  matchesLabels,
  normalizeLabels,
} from "../shared/labels.js";

test("labels normalize whitespace and Unicode while deduplicating without case sensitivity", () => {
  assert.deepEqual(
    normalizeLabels([" Bug ", "bug", "Follow\n up", "cafe\u0301", "CAFÉ"]),
    ["Bug", "Follow up", "café"],
  );
  assert.deepEqual(
    labelPatch(["Bug", "API"], {
      removeLabels: ["bug"],
      addLabels: ["Follow up", "api"],
    }),
    { labels: ["API", "Follow up"] },
  );
  assert.deepEqual(labelPatch(["Bug"], {}), {});
  assert.deepEqual(labelPatch(["Bug"], { labels: [] }), { labels: [] });
  assert.deepEqual(labelPatch(undefined, { addLabels: ["Bug"] }), {
    labels: ["Bug"],
  });
  const delta = labelDelta(["Bug", "API"], ["BUG", "Review"]);
  assert.deepEqual(delta, { addLabels: ["Review"], removeLabels: ["API"] });
  assert.deepEqual(labelPatch(["Bug", "API", "External"], delta).labels, [
    "Bug",
    "External",
    "Review",
  ]);
});

test("labels reject invalid values and excessive counts or lengths", () => {
  for (const value of [
    null,
    "bug",
    [1],
    [""],
    ["  "],
    ["x".repeat(65)],
    Array.from({ length: 21 }, (_, i) => "label-" + i),
  ])
    assert.throws(() => normalizeLabels(value), /label|Label/);
  const labels = Array.from({ length: 20 }, (_, i) => "label-" + i);
  assert.deepEqual(
    labelPatch(labels, { addLabels: ["LABEL-0"] }).labels,
    labels,
  );
  assert.throws(() => labelPatch(labels, { addLabels: ["new"] }), /20 labels/);
  assert.equal(
    labelPatch(labels, { addLabels: ["new"], removeLabels: ["label-0"] }).labels
      ?.length,
    20,
  );
  assert.throws(
    () => labelPatch([], { labels: [], addLabels: ["new"] }),
    /not both/,
  );
});

test("label filtering requires all requested labels and suggestions merge case variants", () => {
  assert.equal(matchesLabels(["Bug", "API"], ["bug", "api"]), true);
  assert.equal(matchesLabels(["Bug"], ["bug", "api"]), false);
  assert.equal(matchesLabels(undefined, ["bug"]), false);
  assert.equal(matchesLabels(undefined, []), true);
  assert.deepEqual(
    availableLabels([{ labels: ["Bug", "API"] }, { labels: ["bug"] }, {}]),
    ["API", "Bug"],
  );
});
