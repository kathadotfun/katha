import assert from "node:assert/strict";
import { test } from "node:test";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import ts from "typescript";
import {
  idleTransactionSnapshot,
  type TransactionSnapshot,
} from "../lib/transaction-lifecycle.ts";
const require = createRequire(import.meta.url);
let code = ts.transpileModule(
  await readFile(
    new URL("../components/transaction-review.tsx", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
for (const [specifier, target] of Object.entries({
  react: pathToFileURL(require.resolve("react")).href,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
  "./wallet-provider":
    "data:text/javascript,export function useTransactionLifecycle(){return null}",
  "../lib/transaction-lifecycle": new URL(
    "../lib/transaction-lifecycle.ts",
    import.meta.url,
  ).href,
}))
  code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(target));
const { TransactionReviewView } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
function render(state: TransactionSnapshot) {
  return renderToStaticMarkup(
    createElement(TransactionReviewView, {
      state,
      onApprove: () => {},
      onCheck: () => {},
      onCancel: () => {},
    }),
  );
}
test("transaction panel displays distinct pending, failure, finalization and indexing states", () => {
  assert.equal(render(idleTransactionSnapshot), "");
  for (const [phase, text] of Object.entries({
    review: "Review transaction before wallet approval",
    signing: "Waiting for wallet signature",
    unknown: "Confirmation unknown",
    expired: "Preparation expired",
    failed: "Finalized transaction failed",
    "indexing-delay": "Transaction finalized; artwork indexing pending",
    indexed: "Transaction finalized and artwork history updated",
  })) {
    const state = {
      ...idleTransactionSnapshot,
      phase: phase as TransactionSnapshot["phase"],
      signature: phase === "review" ? null : "1".repeat(88),
    };
    const html = render(state);
    assert.ok(html.includes(text));
    assert.ok(html.includes('role="status"'));
    assert.equal(html.includes("Approve in wallet and submit"), phase === "review");
    if (["unknown", "indexing-delay", "expired"].includes(phase))
      assert.ok(html.includes("Check this transaction again"));
    if (state.signature) assert.ok(!html.includes("Cancel transaction review"));
  }
  assert.ok(
    render({
      ...idleTransactionSnapshot,
      phase: "not-completed",
      error: "<script>synthetic</script>",
    }).includes("&lt;script&gt;"),
  );
});
