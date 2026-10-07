// Test-only Metaplex adapter. Umi types stay inside this file; callers use Kit.
import {
  deserializeAssetV1,
  PluginType,
  getRevokePluginAuthorityV1InstructionDataSerializer,
  getAddPluginV1InstructionDataSerializer,
  getTransferV1InstructionDataSerializer,
  getUpdatePluginV1InstructionDataSerializer,
} from "@metaplex-foundation/mpl-core";
import { publicKey, lamports as umiLamports } from "@metaplex-foundation/umi";
import { AccountRole, addSignersToInstruction, address } from "@solana/kit";
import type {
  Address,
  EncodedAccount,
  Instruction,
  TransactionSigner,
} from "@solana/kit";
import { CORE_PROGRAM_ADDRESS } from "../../src/core.js";

const system = address("11111111111111111111111111111111");
function common(
  asset: Address,
  collection: Address,
  actor: TransactionSigner,
  data: Uint8Array,
): Instruction {
  return addSignersToInstruction([actor], {
    programAddress: CORE_PROGRAM_ADDRESS,
    accounts: [
      { address: asset, role: AccountRole.WRITABLE },
      { address: collection, role: AccountRole.WRITABLE },
      { address: actor.address, role: AccountRole.WRITABLE_SIGNER },
      { address: actor.address, role: AccountRole.READONLY_SIGNER },
      { address: system, role: AccountRole.READONLY },
      { address: CORE_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data,
  });
}
export function addTransferPlugin(
  asset: Address,
  collection: Address,
  actor: TransactionSigner,
) {
  return common(
    asset,
    collection,
    actor,
    getAddPluginV1InstructionDataSerializer().serialize({
      plugin: { __kind: "TransferDelegate", fields: [{}] },
      initAuthority: null,
    }),
  );
}
export function thawAsOwner(
  asset: Address,
  collection: Address,
  actor: TransactionSigner,
  frozen = false,
) {
  return common(
    asset,
    collection,
    actor,
    getUpdatePluginV1InstructionDataSerializer().serialize({
      plugin: { __kind: "FreezeDelegate", fields: [{ frozen }] },
    }),
  );
}
export function transferAsOwner(
  asset: Address,
  collection: Address,
  actor: TransactionSigner,
  newOwner: Address,
): Instruction {
  return addSignersToInstruction([actor], {
    programAddress: CORE_PROGRAM_ADDRESS,
    accounts: [
      { address: asset, role: AccountRole.WRITABLE },
      { address: collection, role: AccountRole.READONLY },
      { address: actor.address, role: AccountRole.WRITABLE_SIGNER },
      { address: actor.address, role: AccountRole.READONLY_SIGNER },
      { address: newOwner, role: AccountRole.READONLY },
      { address: system, role: AccountRole.READONLY },
      { address: CORE_PROGRAM_ADDRESS, role: AccountRole.READONLY },
    ],
    data: getTransferV1InstructionDataSerializer().serialize({
      compressionProof: null,
    }),
  });
}
export function readListingDelegates(account: EncodedAccount) {
  const asset = deserializeAssetV1({
    publicKey: publicKey(account.address),
    owner: publicKey(account.programAddress),
    lamports: umiLamports(account.lamports),
    executable: account.executable,
    data: Uint8Array.from(account.data),
  });
  const freeze = asset.freezeDelegate;
  const transfer = asset.transferDelegate;
  return {
    owner: address(asset.owner),
    freeze: freeze
      ? {
          frozen: freeze.frozen,
          authority: freeze.authority.type,
          address:
            freeze.authority.type === "Address" &&
            freeze.authority.address !== undefined
              ? address(freeze.authority.address)
              : null,
        }
      : null,
    transfer: transfer
      ? {
          authority: transfer.authority.type,
          address:
            transfer.authority.type === "Address" &&
            transfer.authority.address !== undefined
              ? address(transfer.authority.address)
              : null,
        }
      : null,
  };
}

export function revokeTransferAsOwner(
  asset: Address,
  collection: Address,
  actor: TransactionSigner,
) {
  return common(
    asset,
    collection,
    actor,
    getRevokePluginAuthorityV1InstructionDataSerializer().serialize({
      pluginType: PluginType.TransferDelegate,
    }),
  );
}
