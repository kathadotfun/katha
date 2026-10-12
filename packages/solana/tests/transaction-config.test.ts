import {
  address,
  AccountRole,
  blockhash,
  getTransactionMessageComputeUnitLimit,
  getTransactionMessageLoadedAccountsDataSizeLimit,
  getTransactionMessagePriorityFeeLamports,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageHeapSize,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  setTransactionMessagePriorityFeeLamports,
} from "@solana/kit";
import { describe, expect, it } from "vitest";

import {
  hasKathaTransactionConfig,
  KATHA_V1_COMPUTE_UNIT_LIMIT,
  KATHA_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
  unsignedMessage,
  type RegistryTransactionContext,
} from "../src/registration.js";
import { KATHA_REGISTRY_PROGRAM_ADDRESS } from "../src/generated/registry/index.js";

const wallet = address("DKiWVyP2QHs16f5mncnG3QHJLXev8qPnYKzqP6qmfFHR");
const context = (versions: (0 | 1)[]): RegistryTransactionContext => ({
  cluster: "devnet",
  feePayerAddress: wallet,
  authorityAddress: wallet,
  supportedTransactionVersions: new Set(versions),
  lifetime: {
    blockhash: blockhash("3pEcwUBFEX2XdpcXr5JpSBDeyADXmePayndDTFoqgSun"),
    lastValidBlockHeight: 200n,
  },
  currentBlockHeight: 100n,
});
const instruction = {
  programAddress: KATHA_REGISTRY_PROGRAM_ADDRESS,
  accounts: [{ address: wallet, role: AccountRole.WRITABLE_SIGNER }],
  data: new Uint8Array([1, 2, 3]),
};

describe("Katha transaction resource configuration", () => {
  it("sets explicit v1 limits so omitted header values are not zero", () => {
    const { transactionMessage } = unsignedMessage(context([0, 1]), instruction);
    if (transactionMessage.version !== 1) throw new Error("Expected v1");
    expect(getTransactionMessageComputeUnitLimit(transactionMessage)).toBe(
      KATHA_V1_COMPUTE_UNIT_LIMIT,
    );
    expect(getTransactionMessageLoadedAccountsDataSizeLimit(transactionMessage)).toBe(
      KATHA_V1_LOADED_ACCOUNTS_DATA_SIZE_LIMIT,
    );
    expect(getTransactionMessagePriorityFeeLamports(transactionMessage)).toBe(0n);
    expect(transactionMessage.instructions).toHaveLength(1);
    expect(hasKathaTransactionConfig(transactionMessage)).toBe(true);
  });

  it("leaves v0 messages as a single program instruction", () => {
    const { transactionMessage } = unsignedMessage(context([0]), instruction);
    expect(transactionMessage.version).toBe(0);
    expect(transactionMessage.instructions).toHaveLength(1);
    expect(hasKathaTransactionConfig(transactionMessage)).toBe(true);
  });

  it("rejects v1 messages with changed or missing resource fields", () => {
    const { transactionMessage } = unsignedMessage(context([1]), instruction);
    if (transactionMessage.version !== 1) throw new Error("Expected v1");
    for (const changed of [
      setTransactionMessageComputeUnitLimit(1_400_000, transactionMessage),
      setTransactionMessageComputeUnitLimit(undefined, transactionMessage),
      setTransactionMessageLoadedAccountsDataSizeLimit(undefined, transactionMessage),
      setTransactionMessagePriorityFeeLamports(5_000n, transactionMessage),
      setTransactionMessageHeapSize(256 * 1024, transactionMessage),
    ])
      expect(hasKathaTransactionConfig(changed)).toBe(false);
  });
});
