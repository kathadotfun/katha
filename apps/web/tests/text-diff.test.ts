import assert from "node:assert/strict";
import { test } from "node:test";
import { wordDiff } from "../lib/text-diff.ts";

test("word diff marks only the changed words and preserves the full text", () => {
  const parts = wordDiff(
    "Displayed during Dashain in the shrine.",
    "Displayed during Dasain in the shrine.",
  );
  assert.deepEqual(
    parts.filter((part) => part.kind !== "same").map((part) => [part.kind, part.text]),
    [
      ["removed", "Dashain"],
      ["added", "Dasain"],
    ],
  );
  assert.equal(
    parts
      .filter((p) => p.kind !== "added")
      .map((p) => p.text)
      .join(""),
    "Displayed during Dashain in the shrine.",
  );
  assert.equal(
    parts
      .filter((p) => p.kind !== "removed")
      .map((p) => p.text)
      .join(""),
    "Displayed during Dasain in the shrine.",
  );
  assert.deepEqual(wordDiff("same", "same"), [{ kind: "same", text: "same" }]);
  assert.deepEqual(
    wordDiff("a b", "c d", 1).map((p) => p.kind),
    ["removed", "added"],
  );
});
