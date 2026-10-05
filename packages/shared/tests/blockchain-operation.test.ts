import { expect, it } from "vitest";
import {
  operationIntentSchema,
  unsignedOperationResponseSchema,
} from "../src/blockchain-operation.js";
const intent = {
  artworkId: "11111111-1111-4111-8111-111111111111",
  kathaId: "KATHA-PAUBHA-000001",
  kind: "REGISTER_ARTWORK",
  idempotencyKey: "synthetic",
  expectedAccounts: ["TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"],
  expectedHashes: [],
  parameters: { year: 2026 },
};
it("accepts internal registry intents with exact JSON domain inputs", () => {
  expect(operationIntentSchema.parse(intent)).toEqual(intent);
});
it.each([
  { ...intent, kind: "PURCHASE_ARTWORK" },
  { ...intent, privateKey: "secret" },
  { ...intent, idempotencyKey: "with space" },
  { ...intent, expectedAccounts: [] },
  { ...intent, expectedHashes: ["invalid"] },
  { ...intent, parameters: { amount: 1n } },
  {
    ...intent,
    expectedAccounts: [...intent.expectedAccounts, ...intent.expectedAccounts],
  },
])("rejects malformed or out-of-scope intents", (value) => {
  expect(operationIntentSchema.safeParse(value).success).toBe(false);
});
const response = {
  operationId: intent.artworkId,
  preparationId: intent.artworkId,
  kathaId: intent.kathaId,
  kind: intent.kind,
  cluster: "localnet",
  status: "PREPARED",
  requestHash: "a".repeat(64),
  messageHash: "b".repeat(64),
  transactionBase64: "AAAA",
  transactionVersion: 0,
  feePayer: intent.expectedAccounts[0],
  requiredSignerAddresses: intent.expectedAccounts,
  blockhash: "11111111111111111111111111111111",
  lastValidBlockHeight: "100",
  simulation: { slot: "20", unitsConsumed: null },
};
it("uses integer decimal strings and omits private canonical requests", () => {
  expect(unsignedOperationResponseSchema.parse(response)).toEqual(response);
});
it.each([
  { ...response, lastValidBlockHeight: 100 },
  { ...response, lastValidBlockHeight: "01" },
  { ...response, status: "FINALIZED" },
  { ...response, transactionBase64: "not base64" },
  { ...response, canonicalRequest: "private" },
  { ...response, requiredSignerAddresses: [] },
])("rejects unsafe response projections", (value) => {
  expect(unsignedOperationResponseSchema.safeParse(value).success).toBe(false);
});
