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
async function compile(path: string, aliases: Readonly<Record<string, string>>) {
  let source = ts.transpileModule(
    await readFile(new URL(path, import.meta.url), "utf8"),
    { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
  ).outputText;
  for (const [specifier, target] of Object.entries(aliases))
    source = source.replaceAll(JSON.stringify(specifier), JSON.stringify(target));
  return `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
}
const runtime = {
  react: pathToFileURL(require.resolve("react")).href,
  "react/jsx-runtime": pathToFileURL(require.resolve("react/jsx-runtime")).href,
};
const statusModule = await compile("../components/ui/status.tsx", runtime);
let code = ts.transpileModule(
  await readFile(
    new URL("../components/transaction-review.tsx", import.meta.url),
    "utf8",
  ),
  { compilerOptions: { module: ts.ModuleKind.ESNext, jsx: ts.JsxEmit.ReactJSX } },
).outputText;
for (const [specifier, target] of Object.entries({
  "./ui/status": statusModule,
  "../lib/format": new URL("../lib/format.ts", import.meta.url).href,
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
    assert.equal(html.includes(">Approve in wallet<"), phase === "review");
    if (["unknown", "indexing-delay", "expired"].includes(phase))
      assert.ok(html.includes(">Check status<"));
    if (state.signature) assert.ok(!html.includes(">Cancel<"));
  }
  assert.ok(
    render({
      ...idleTransactionSnapshot,
      phase: "not-completed",
      error: "<script>synthetic</script>",
    }).includes("&lt;script&gt;"),
  );
});

test("purchase review shows exact payment/recipients and separates Core ownership from indexer catch-up", async () => {
  const { purchaseFixture } = await import("./fixtures/purchase.ts");
  const { operation } = await purchaseFixture();
  const state = {
    ...idleTransactionSnapshot,
    phase: "review" as const,
    operation,
    feeLamports: "5000",
  };
  const html = render(state);
  assert.ok(html.includes("100000001 base units"));
  assert.ok(html.includes("97500001 base units"));
  assert.ok(html.includes(operation.quote.payment.paymentMint));
  assert.ok(!html.includes("No token payment is included"));
  assert.ok(
    render({ ...state, phase: "indexing-delay" }).includes(
      "Core ownership and indexing checks pending",
    ),
  );
  assert.ok(
    render({
      ...state,
      phase: "indexing-delay",
      purchaseOwnerConfirmed: true,
    }).includes("buyer Core ownership confirmed; artwork indexing pending"),
  );
  assert.ok(
    render({ ...state, phase: "indexed", purchaseOwnerConfirmed: true }).includes(
      "transfer history indexed",
    ),
  );
});
