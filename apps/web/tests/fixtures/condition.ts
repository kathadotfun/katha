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
  getInitializeConditionInstructionAsync,
  getRecordUnmintedConditionInstructionAsync,
  getRecordMintedConditionInstructionAsync,
  findArtworkPda,
  ConditionGrade,
  ConditionReason,
} from "@katha/solana/registry";
import {
  canonicalDocumentBytes,
  sha256Hex,
  type ConditionInspectionReview,
  type ConditionReportDocument,
} from "@katha/shared";
import { registrationFixture } from "./registration.ts";
export async function conditionFixture(
  mode: "initial" | "unminted" | "minted" = "initial",
  walletAddress = "11111111111111111111111111111112",
  overrides: {
    document?: ConditionReportDocument;
    hash?: string;
    expectedVersion?: number;
    owner?: string;
    revision?: bigint;
    reportAddress?: string;
    headAddress?: string;
    systemProgram?: string;
    extraAccount?: string;
  } = {},
) {
  const base = await registrationFixture(undefined, walletAddress),
    signer = createNoopSigner(address(walletAddress));
  const document: ConditionReportDocument = overrides.document ?? {
    reportId: "cccccccc-1111-4111-8111-111111111111",
    kathaId: base.page.kathaId,
    inspectorId: "bbbbbbbb-1111-4111-8111-111111111111",
    verifierWallet: walletAddress,
    grade: "GOOD",
    reason:
      mode === "initial"
        ? "INITIAL_VERIFICATION"
        : mode === "minted"
          ? "PRE_RESALE"
          : "PRE_SALE",
    inspectedAt: "2026-10-05T00:00:00.000Z",
    reportedAt: "2026-10-05T00:00:01.000Z",
    notes: "Synthetic private inspection notes",
    mediaHashes: ["a".repeat(64)],
    ...(mode === "minted"
      ? {
          scope: {
            ownerWallet: walletAddress,
            custodyRevision: 1,
            custodyState: "KATHA_HELD" as const,
          },
        }
      : {}),
  };
  const canonicalDocument = new TextDecoder().decode(canonicalDocumentBytes(document)),
    hash = await sha256Hex(canonicalDocumentBytes(document));
  const uuid = (id: string) =>
    Uint8Array.from(Buffer.from(id.replaceAll("-", ""), "hex"));
  const [artwork] = await findArtworkPda({ kathaId: document.kathaId });
  const data = {
    artwork,
    verifierAuthority: signer,
    reportId: uuid(document.reportId),
    inspectorId: uuid(document.inspectorId),
    reportHash: Uint8Array.from(Buffer.from(overrides.hash ?? hash, "hex")),
    grade: ConditionGrade.Good,
    reason:
      mode === "initial"
        ? ConditionReason.InitialVerification
        : mode === "minted"
          ? ConditionReason.PreResale
          : ConditionReason.PreSale,
    inspectedAt: BigInt(Date.parse(document.inspectedAt) / 1000),
    ...(overrides.reportAddress ? { report: address(overrides.reportAddress) } : {}),
    ...(overrides.headAddress ? { head: address(overrides.headAddress) } : {}),
    ...(overrides.systemProgram
      ? { systemProgram: address(overrides.systemProgram) }
      : {}),
  };
  const versions = {
    expectedVersion: overrides.expectedVersion ?? 1,
    nextVersion: (overrides.expectedVersion ?? 1) + 1,
  };
  const ix =
    mode === "initial"
      ? await getInitializeConditionInstructionAsync(data)
      : mode === "unminted"
        ? await getRecordUnmintedConditionInstructionAsync({ ...data, ...versions })
        : await getRecordMintedConditionInstructionAsync({
            ...data,
            ...versions,
            expectedOwner: address(overrides.owner ?? walletAddress),
            expectedCustodyRevision: overrides.revision ?? 1n,
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
                ...ix,
                accounts: [
                  ...ix.accounts,
                  { address: address(overrides.extraAccount), role: 0 },
                ],
              }
            : ix,
          msg,
        ),
    ),
  );
  const operation = {
    ...base.operation,
    kind: "RECORD_CONDITION" as const,
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
  };
  const page: ConditionInspectionReview = {
    kathaId: document.kathaId,
    title: base.page.title,
    cluster: "localnet",
    updatedAt: base.page.updatedAt,
    chain: {
      version: mode === "initial" ? 0 : 1,
      minted: mode === "minted",
      scope: document.scope ?? null,
      observedAt: "2026-10-05T00:01:00.000Z",
      allowedReasons:
        mode === "initial"
          ? ["INITIAL_VERIFICATION"]
          : mode === "minted"
            ? [
                "PRE_RESALE",
                "PRE_SALE",
                "POST_DELIVERY",
                "RETURN_TO_CUSTODY",
                "INSURANCE",
              ]
            : ["PRE_SALE", "INSURANCE"],
    },
    media: [
      {
        id: "dddddddd-1111-4111-8111-111111111111",
        contentHash: "a".repeat(64),
        mimeType: "image/png",
        byteSize: "67",
      },
    ],
    report: {
      id: document.reportId,
      version: mode === "initial" ? 1 : 2,
      status: "PREPARED",
      documentHash: hash,
      canonicalDocument,
    },
    attestation: { finalized: false, unresolved: false, receipt: null },
    unresolved: false,
  };
  return { page, document, operation };
}
