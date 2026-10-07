import { expect, it } from "vitest";
import {
  generateKeyPairSigner,
  compileTransaction,
  signTransaction,
  getBase64EncodedWireTransaction,
} from "@solana/kit";
import { canonicalDocumentBytes, sha256Hex } from "@katha/shared";
import { marketplaceTransactionFixture } from "./fixtures/marketplace-transactions.js";
import {
  buildCreateListingTransaction,
  buildCancelListingTransaction,
} from "../src/marketplace.js";
import { unsignedMessage } from "../src/registration.js";
import { encodeUnsignedRegistryTransaction } from "../src/operation-preparation.js";
import {
  validateSignedPreparation,
  type ReceiptPreparation,
} from "../src/operation-receipt.js";
import * as market from "../src/generated/marketplace/index.js";
async function fixture(version: 0 | 1, cancel: boolean) {
  const f = await marketplaceTransactionFixture();
  const actor = await generateKeyPairSigner();
  // Real builders bind the fixture's seller; reconstruct only the actor signer for a genuine signed-message receipt fixture.
  const context = {
    ...f.context,
    cluster: version === 0 ? ("localnet" as const) : ("devnet" as const),
    authorityAddress: f.seller,
    feePayerAddress: f.seller,
    supportedTransactionVersions: new Set([version]),
  };
  if (!cancel) f.accounts.listingAccount = { exists: false, address: f.listing };
  const prepared = cancel
    ? await buildCancelListingTransaction(context, f.accounts, {
        kathaId: f.kathaId,
        expectedRevision: 1n,
      })
    : await buildCreateListingTransaction(context, f.accounts, {
        kathaId: f.kathaId,
        expectedRevision: 0n,
        price: "100000000",
        expiresAt: BigInt(f.ledger.expiresAt),
      });
  const instruction = {
    ...prepared.instruction,
    accounts: prepared.instruction.accounts.map((a) => ({
      ...a,
      address: a.address === f.seller ? actor.address : a.address,
    })),
  };
  const message = unsignedMessage(
    { ...context, authorityAddress: actor.address, feePayerAddress: actor.address },
    instruction,
  );
  const artifact = await encodeUnsignedRegistryTransaction(message);
  const id = "11111111-1111-4111-8111-111111111111",
    kind = cancel ? "CANCEL_LISTING" : "CREATE_LISTING";
  const expectedAccounts = [
    ...new Set([
      actor.address,
      instruction.programAddress,
      ...instruction.accounts.map((a) => a.address),
    ]),
  ].sort();
  const canonicalRequest = new TextDecoder().decode(
    canonicalDocumentBytes({
      schemaVersion: 1,
      artworkId: id,
      kathaId: f.kathaId,
      kind,
      idempotencyKey: "listing-receipt",
      expectedAccounts,
      expectedHashes: [],
      parameters: {},
      cluster: context.cluster,
      walletId: id,
      authorityWallet: actor.address,
      feePayer: actor.address,
      programAddress: instruction.programAddress,
      instruction: {
        programAddress: instruction.programAddress,
        accounts: instruction.accounts.map(({ address, role }) => ({ address, role })),
        dataHex: Buffer.from(instruction.data).toString("hex"),
      },
    }),
  );
  const expected: ReceiptPreparation = {
    ...artifact,
    canonicalRequest,
    requestHash: await sha256Hex(new TextEncoder().encode(canonicalRequest)),
    wallet: actor.address,
    walletId: id,
    cluster: context.cluster,
    kind,
    artworkId: id,
    idempotencyKey: "listing-receipt",
    programAddress: instruction.programAddress,
    expectedAccounts,
    expectedHashes: [],
  };
  const wire = getBase64EncodedWireTransaction(
    await signTransaction(
      [actor.keyPair],
      compileTransaction(message.transactionMessage),
    ),
  );
  return { expected, wire, unsigned: artifact.transactionBase64 };
}
it.each([
  [0, false],
  [0, true],
  [1, false],
  [1, true],
] as const)(
  "accepts only the exact owner-signed v%s listing/cancellation preparation (%s)",
  async (version, cancel) => {
    const f = await fixture(version, cancel);
    expect((await validateSignedPreparation(f.wire, f.expected)).messageHash).toBe(
      f.expected.messageHash,
    );
    await expect(validateSignedPreparation(f.unsigned, f.expected)).rejects.toThrow();
    await expect(
      validateSignedPreparation(f.wire, {
        ...f.expected,
        kind: cancel ? "CREATE_LISTING" : "CANCEL_LISTING",
      }),
    ).rejects.toThrow();
    // Even a consistently rehashed stored intent cannot authorize a different instruction kind.
    const kind = cancel ? "CREATE_LISTING" : "CANCEL_LISTING";
    const canonicalRequest = new TextDecoder().decode(
      canonicalDocumentBytes({ ...JSON.parse(f.expected.canonicalRequest), kind }),
    );
    await expect(
      validateSignedPreparation(f.wire, {
        ...f.expected,
        kind,
        canonicalRequest,
        requestHash: await sha256Hex(new TextEncoder().encode(canonicalRequest)),
      }),
    ).rejects.toThrow();
    await expect(
      validateSignedPreparation(f.wire, { ...f.expected, kind: "PURCHASE_ARTWORK" }),
    ).rejects.toThrow();
    await expect(
      validateSignedPreparation(f.wire, {
        ...f.expected,
        programAddress: market.KATHA_MARKETPLACE_PROGRAM_ADDRESS.slice(1),
      }),
    ).rejects.toThrow();
  },
);
