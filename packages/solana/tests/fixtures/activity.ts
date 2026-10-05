import { address, getBase58Decoder } from "@solana/kit";
import { CORE_PROGRAM_ADDRESS } from "../../src/core.js";
import {
  KATHA_REGISTRY_PROGRAM_ADDRESS,
  getArtworkVerifiedEventEncoder,
  getVerifyArtworkInstructionDataEncoder,
} from "../../src/generated/registry/index.js";
export const SYSTEM = address("11111111111111111111111111111111");
export const ARTWORK = address("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const OWNER = address("Vote111111111111111111111111111111111111111");
export const COLLECTION = address("BPFLoaderUpgradeab1e11111111111111111111111");
export const SIG = getBase58Decoder().decode(new Uint8Array(64).fill(1));
export const OTHER_SIG = getBase58Decoder().decode(new Uint8Array(64).fill(2));
export const SLOT = 123n;
export const base58 = (data: ArrayLike<number>) =>
  getBase58Decoder().decode(Uint8Array.from(data));
export const eventBytes = () =>
  getArtworkVerifiedEventEncoder().encode({
    artwork: ARTWORK,
    kathaId: "KATHA-PAUBHA-000001",
    authorshipEvidenceHash: new Uint8Array(32).fill(3),
    verifier: SYSTEM,
    verifiedAt: 1n,
  });
export const eventLog = () =>
  `Program data: ${Buffer.from(eventBytes()).toString("base64")}`;
export function activityFixture(program = KATHA_REGISTRY_PROGRAM_ADDRESS as string) {
  const registry = program === KATHA_REGISTRY_PROGRAM_ADDRESS;
  return {
    slot: SLOT,
    blockTime: 1n,
    version: 0 as "legacy" | number,
    transaction: {
      signatures: [SIG],
      message: {
        accountKeys: [
          KATHA_REGISTRY_PROGRAM_ADDRESS,
          CORE_PROGRAM_ADDRESS,
          SYSTEM,
          ARTWORK,
          OWNER,
          COLLECTION,
        ] as string[],
        addressTableLookups: [] as unknown[],
        instructions: [
          {
            programIdIndex: registry ? 0 : 1,
            accounts: registry ? [2, 3, 5, 2, 2] : [3, 5, 2, 2, 4],
            data: registry
              ? base58(
                  getVerifyArtworkInstructionDataEncoder().encode({
                    expectedAuthorshipEvidenceHash: new Uint8Array(32).fill(3),
                  }),
                )
              : base58([14, 0]),
            stackHeight: 1 as number | null,
          },
        ],
      },
    },
    meta: {
      err: null as unknown,
      loadedAddresses: { writable: [] as string[], readonly: [] as string[] },
      innerInstructions: [] as {
        index: number;
        instructions: {
          programIdIndex: number;
          accounts: number[];
          data: string;
          stackHeight: number | null;
        }[];
      }[],
      logMessages: [
        `Program ${program} invoke [1]`,
        ...(registry ? [eventLog()] : []),
        `Program ${program} success`,
      ],
    },
  };
}
