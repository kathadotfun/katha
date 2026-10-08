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
  getInitializeCustodyInstructionAsync,
  getTransitionCustodyInstructionAsync,
  findArtworkPda,
  CustodyAction,
} from "@katha/solana/registry";
import {
  physicalCustodyTransitionSchema,
  sha256Hex,
  type CustodyAdministrationReview,
} from "@katha/shared";
import { registrationFixture } from "./registration.ts";
export async function custodyFixture(
  action: string = "ATTEST_KATHA_CUSTODY",
  walletAddress = "11111111111111111111111111111112",
  overrides: {
    revision?: bigint;
    collector?: string | null;
    head?: string;
    transition?: string;
    systemProgram?: string;
    extraAccount?: string;
  } = {},
) {
  const base = await registrationFixture(undefined, walletAddress),
    signer = createNoopSigner(address(walletAddress));
  const option = physicalCustodyTransitionSchema.options.find(
    (row) => row.shape.action.value === action,
  )!;
  const transition = option.parse({
    action,
    from: option.shape.from.value,
    to: option.shape.to.value,
  });
  const revision = overrides.revision ?? (transition.from === "UNKNOWN" ? 0n : 1n);
  const collectorWallet =
    transition.to === "COLLECTOR_HELD" ? "11111111111111111111111111111113" : null;
  const [artwork] = await findArtworkPda({ kathaId: base.page.kathaId });
  const actions = {
    ATTEST_KATHA_CUSTODY: CustodyAction.AttestKathaCustody,
    ATTEST_COLLECTOR_CUSTODY: CustodyAction.AttestCollectorCustody,
    DISPATCH_FROM_KATHA: CustodyAction.DispatchFromKatha,
    DISPATCH_FROM_COLLECTOR: CustodyAction.DispatchFromCollector,
    RECEIVE_AT_KATHA: CustodyAction.ReceiveAtKatha,
    RECEIVE_BY_COLLECTOR: CustodyAction.ReceiveByCollector,
  };
  const selectedCollector =
    overrides.collector === undefined ? collectorWallet : overrides.collector;
  const data = {
    artwork,
    custodyAuthority: signer,
    action: actions[transition.action],
    collector: selectedCollector === null ? null : address(selectedCollector),
    ...(overrides.head ? { head: address(overrides.head) } : {}),
    ...(overrides.transition ? { transition: address(overrides.transition) } : {}),
    ...(overrides.systemProgram
      ? { systemProgram: address(overrides.systemProgram) }
      : {}),
  };
  const ix =
    transition.from === "UNKNOWN"
      ? await getInitializeCustodyInstructionAsync(data)
      : await getTransitionCustodyInstructionAsync({
          ...data,
          expectedRevision: revision,
          nextRevision: revision + 1n,
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
    kind: "UPDATE_CUSTODY" as const,
    messageHash: await sha256Hex(Uint8Array.from(transaction.messageBytes)),
    transactionBase64: String(getBase64EncodedWireTransaction(transaction)),
  };
  const page: CustodyAdministrationReview = {
    kathaId: base.page.kathaId,
    title: base.page.title,
    updatedAt: base.page.updatedAt,
    cluster: "localnet",
    chain: {
      revision: transition.from === "UNKNOWN" ? "0" : "1",
      state: transition.from,
      subject:
        transition.from === "UNKNOWN" || transition.from === "IN_TRANSIT"
          ? null
          : walletAddress,
      ownerWallet: null,
      custodyAuthority: walletAddress,
    },
    canAttest: true,
    transitions: [transition],
    custody: { finalized: false, unresolved: false, receipt: null },
    requests: [
      {
        request: {
          id: "eeeeeeee-1111-4111-8111-111111111111",
          kathaId: base.page.kathaId,
          kind: "DELIVERY",
          status: "REQUESTED",
          recipientName: "Synthetic recipient",
          contactEmail: "synthetic@example.invalid",
          contactPhone: null,
          addressLines: ["Synthetic address"],
          city: "Synthetic city",
          region: null,
          postalCode: null,
          countryCode: "NP",
          deliveryInstructions: "Synthetic private instructions",
          courier: null,
          trackingReference: null,
          ownerReportedReceivedAt: null,
          createdAt: base.page.updatedAt,
          updatedAt: base.page.updatedAt,
        },
        ownerMatches: true,
        allowedStatuses: ["APPROVED", "CANCELLED"],
        transitions: [],
      },
    ],
    pagination: { limit: 20, offset: 0, hasMore: false },
  };
  return { page, operation, transition, collectorWallet };
}
