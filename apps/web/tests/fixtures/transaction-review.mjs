import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import { URL, pathToFileURL } from "node:url";
const require = createRequire(new URL("../../package.json", import.meta.url));
const { createElement } = require("react");
const { renderToStaticMarkup } = require("react-dom/server");
const ts = require("typescript");
let code = ts.transpileModule(
  await readFile(
    new URL("../../components/transaction-review.tsx", import.meta.url),
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
    "../../lib/transaction-lifecycle.ts",
    import.meta.url,
  ).href,
}))
  code = code.replaceAll(JSON.stringify(specifier), JSON.stringify(target));
const { TransactionReviewView } = await import(
  `data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
);
// Render the actual view with synthetic public state. No controller, signing or
// submission is mounted into the production app by this test-only module.
export function renderTransactionReviewPhase(phase) {
  return renderToStaticMarkup(
    createElement(TransactionReviewView, {
      state: {
        phase,
        accounts: [{ address: "11111111111111111111111111111111", role: 3 }],
        feeLamports: "5000",
        program: "Gy1weme3YxEYuuMbJ2MnmLXerPqoSW9X3CAQ86wyZAtr",
        signature: ["review", "signing"].includes(phase) ? null : "1".repeat(88),
        error: null,
        operation: {
          kind: "REGISTER_ARTWORK",
          kathaId: "KATHA-PAUBHA-000001",
          cluster: "localnet",
          transactionVersion: 0,
          feePayer: "11111111111111111111111111111111",
          messageHash: "a".repeat(64),
        },
      },
      onApprove: () => {},
      onCheck: () => {},
      onCancel: () => {},
    }),
  );
}
