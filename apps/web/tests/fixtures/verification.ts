import {
  address,
  createNoopSigner,
  createTransactionMessage,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  appendTransactionMessageInstruction,
  compileTransaction,
  getBase64EncodedWireTransaction,
  blockhash,
  pipe,
} from "@solana/kit";
import {
  getVerifyArtworkInstructionAsync,
  findArtworkPda,
} from "@katha/solana/registry";
import { sha256Hex, type ArtworkVerificationReview } from "@katha/shared";
import { registrationFixture } from "./registration.ts";
export async function verificationFixture(
  kathaId = "KATHA-PAUBHA-000050",
  walletAddress = "11111111111111111111111111111112",
  overrides: {
    evidenceByte?: number;
    verificationAddress?: string;
    systemProgram?: string;
    extraAccount?: string;
  } = {},
) {
  const base = await registrationFixture(kathaId, walletAddress);
  const page: ArtworkVerificationReview = {
    ...base.page,
    registration: { finalized: true, unresolved: false, receipt: null },
    verification: { finalized: false, unresolved: false, receipt: null },
  };
  const signer = createNoopSigner(address(walletAddress));
  const [artwork] = await findArtworkPda({ kathaId });
  const instruction = await getVerifyArtworkInstructionAsync({
    verifierAuthority: signer,
    artwork,
    expectedAuthorshipEvidenceHash: new Uint8Array(32).fill(
      overrides.evidenceByte ?? 0xee,
    ),
    ...(overrides.verificationAddress
      ? { verification: address(overrides.verificationAddress) }
      : {}),
    ...(overrides.systemProgram
      ? { systemProgram: address(overrides.systemProgram) }
      : {}),
  });
  const transaction = compileTransaction(
    pipe(
      createTransactionMessage({ version: 0 }),
      (msg) => setTransactionMessageFeePayer(signer.address, msg),
      (msg) =>
        setTransactionMessageLifetimeUsingBlockhash(
          {
            blockhash: blockhash("11111111111111111111111111111111"),
            lastValidBlockHeight: 1000n,
          },
          msg,
        ),
      (msg) =>
        appendTransactionMessageInstruction(
          overrides.extraAccount
            ? {
                ...instruction,
                accounts: [
                  ...instruction.accounts,
                  { address: address(overrides.extraAccount), role: 0 },
                ],
              }
            : instruction,
          msg,
        ),
    ),
  );
  const operation = {
    ...base.operation,
    kind: "VERIFY_ARTWORK" as const,
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
  };
  return { page, operation };
}
