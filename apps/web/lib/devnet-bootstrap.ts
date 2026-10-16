import {
  devnetBootstrapSchema,
  devnetSaleTermsSchema,
  type DevnetBootstrapStep,
  type DevnetBootstrap,
  type DevnetSaleTerms,
} from "@katha/shared";
import {
  prepareDevnetBootstrapInstruction,
  selectKathaTransactionVersion,
  verifyWalletSignature,
} from "@katha/solana";
import { assertKathaRpcCluster } from "@katha/solana/rpc-cluster";
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createSolanaRpc,
  createTransactionMessage,
  fetchEncodedAccount,
  estimateResourceLimitsFactory,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isTransactionModifyingSigner,
  partiallySignTransactionWithSigners,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessagePriorityFeeLamports,
  setTransactionMessageLoadedAccountsDataSizeLimit,
  signature,
  type Instruction,
  type TransactionPartialSigner,
  type TransactionMessageBytesBase64,
  type ReadonlyUint8Array,
} from "@solana/kit";
import type { WalletNamespace } from "@solana/kit-plugin-wallet";
import { publicTransactionRpcUrl } from "./transaction-rpc.ts";

const publicApprovalErrors = new Set([
  "Wallet changed; prepare again",
  "Unsigned review expired; prepare again",
  "Bootstrap intent changed",
  "Bootstrap simulation failed; no wallet approval requested",
  "Wallet cannot sign separately",
  "Wallet signing did not complete. Check the selected wallet and approve within 20 seconds; no transaction was submitted.",
  "Wallet did not return a transaction",
  "Wallet changed the reviewed transaction message",
  "Wallet changed during approval",
  "Wallet changed required signers",
  "Bootstrap signature did not match the approved message",
]);

type ApprovalStage =
  | "wallet connection"
  | "network and expiry checks"
  | "account prerequisites"
  | "repeat simulation"
  | "wallet signing"
  | "signed message validation"
  | "signature validation"
  | "signature retention"
  | "submission";
class BootstrapApprovalError extends Error {
  constructor(stage: ApprovalStage) {
    super(
      `Registry/bootstrap approval stopped during ${stage}. No replacement was sent.`,
    );
  }
}

/** Never expose arbitrary wallet/RPC errors, which can contain sensitive context. */
export function publicBootstrapFailure(error: unknown): string {
  if (error instanceof BootstrapApprovalError) return error.message;
  if (error instanceof Error && publicApprovalErrors.has(error.message))
    return error.message;
  return "Action could not complete. Check public input, operator authority, network and simulation prerequisites. No replacement was sent.";
}

function instructionKey(instruction: Instruction) {
  return JSON.stringify({
    program: instruction.programAddress,
    accounts: instruction.accounts?.map(({ address, role }) => ({ address, role })),
    data: Array.from(instruction.data ?? []),
  });
}
export function assertUnmodifiedBootstrapMessage(
  before: ReadonlyUint8Array,
  after: ReadonlyUint8Array,
) {
  if (
    before.length !== after.length ||
    !before.every((byte, index) => byte === after[index])
  )
    throw new Error("Wallet changed the reviewed transaction message");
}
export type DevnetBootstrapPrepared = Readonly<{
  step: DevnetBootstrapStep;
  config: DevnetBootstrap;
  sale: DevnetSaleTerms | undefined;
  collectionSigner: TransactionPartialSigner | undefined;
  wallet: NonNullable<ReturnType<WalletNamespace["getState"]>["connected"]>["wallet"];
  transaction: ReturnType<typeof compileTransaction>;
  instructionKey: string;
  lastValidBlockHeight: bigint;
  summary: string;
}>;

/** Separate operator utility: no API token, keypair file, automatic signing or deployment. */
export function createDevnetBootstrapClient(
  wallet: Pick<WalletNamespace, "getState">,
  rpcUrl?: string,
  transport?: ReturnType<typeof createSolanaRpc>,
) {
  const rpc = transport ?? createSolanaRpc(publicTransactionRpcUrl("devnet", rpcUrl));
  const signal = () => AbortSignal.timeout(20_000);
  const read = (key: Parameters<typeof fetchEncodedAccount>[1]) =>
    fetchEncodedAccount(rpc, key, { commitment: "finalized", abortSignal: signal() });
  async function checkNetwork() {
    assertKathaRpcCluster(
      await rpc.getGenesisHash().send({ abortSignal: signal() }),
      "devnet",
    );
  }
  function connected() {
    const state = wallet.getState();
    if (
      state.status !== "connected" ||
      !state.connected ||
      !state.connected.signer ||
      !isTransactionModifyingSigner(state.connected.signer)
    )
      throw new Error(
        "Connect a Devnet wallet supporting separate transaction signing",
      );
    return state.connected;
  }
  async function simulate(
    transaction: Parameters<typeof getBase64EncodedWireTransaction>[0],
  ) {
    const response = await rpc
      .simulateTransaction(getBase64EncodedWireTransaction(transaction), {
        encoding: "base64",
        commitment: "confirmed",
        sigVerify: false,
        replaceRecentBlockhash: false,
      })
      .send({ abortSignal: signal() });
    if (response.value.err !== null)
      throw new Error("Bootstrap simulation failed; no wallet approval requested");
    return response;
  }
  return {
    async prepare(
      step: DevnetBootstrapStep,
      input: unknown,
      saleInput?: unknown,
      collectionSigner?: TransactionPartialSigner,
    ): Promise<DevnetBootstrapPrepared> {
      const config = devnetBootstrapSchema.parse(input);
      const sale =
        step === "sale-terms" ? devnetSaleTermsSchema.parse(saleInput) : undefined;
      const actor = connected();
      if (actor.account.address !== config.operator)
        throw new Error("Connected wallet does not match the public operator");
      if (step === "collection" && collectionSigner?.address !== config.collection)
        throw new Error(
          "Generate the temporary Devnet collection account in this tab first",
        );
      await checkNetwork();
      const generated = await prepareDevnetBootstrapInstruction(
        step,
        config,
        read,
        sale,
      );
      const instruction: Instruction = {
        programAddress: generated.programAddress,
        data: Uint8Array.from(generated.data ?? []),
        accounts: (generated.accounts ?? []).map(({ address, role }) => ({
          address,
          role,
        })),
      };
      const lifetime = await rpc
        .getLatestBlockhash({ commitment: "confirmed" })
        .send({ abortSignal: signal() });
      const baseMessage = appendTransactionMessageInstruction(
        instruction,
        setTransactionMessageLifetimeUsingBlockhash(
          lifetime.value,
          setTransactionMessageFeePayer(
            address(config.operator),
            createTransactionMessage({
              version: selectKathaTransactionVersion(
                "devnet",
                actor.supportedTransactionVersions,
              ),
            }),
          ),
        ),
      );
      // Specify v0 fees before wallet review so wallets need not insert their
      // own priority-fee instructions. Mutation after approval remains forbidden.
      const feeMessage =
        baseMessage.version === 0
          ? setTransactionMessageComputeUnitPrice(0n, { ...baseMessage, version: 0 })
          : setTransactionMessagePriorityFeeLamports(0n, {
              ...baseMessage,
              version: 1,
            });
      const estimate = await estimateResourceLimitsFactory({ rpc })(feeMessage, {
        commitment: "confirmed",
        abortSignal: signal(),
      });
      if (
        !Number.isSafeInteger(estimate.computeUnitLimit) ||
        estimate.computeUnitLimit <= 0 ||
        estimate.computeUnitLimit > 1_400_000
      )
        throw new Error("Bootstrap compute estimate unavailable");
      const computeUnitLimit = Math.min(
        1_400_000,
        Math.ceil((estimate.computeUnitLimit * 11) / 10),
      );
      const limitedMessage = setTransactionMessageComputeUnitLimit(
        computeUnitLimit,
        feeMessage,
      );
      const message =
        limitedMessage.version === 1
          ? setTransactionMessageLoadedAccountsDataSizeLimit(
              "loadedAccountsDataSizeLimit" in estimate
                ? estimate.loadedAccountsDataSizeLimit
                : undefined,
              limitedMessage,
            )
          : limitedMessage;
      const transaction = compileTransaction(message);
      const simulation = await simulate(transaction);
      const fee = await rpc
        .getFeeForMessage(
          getBase64Decoder().decode(
            transaction.messageBytes,
          ) as TransactionMessageBytesBase64,
          { commitment: "confirmed" },
        )
        .send({ abortSignal: signal() });
      if (fee.value === null) throw new Error("Network fee estimate unavailable");
      return Object.freeze({
        step,
        config,
        sale,
        collectionSigner: step === "collection" ? collectionSigner : undefined,
        wallet: actor.wallet,
        transaction,
        instructionKey: instructionKey(instruction),
        lastValidBlockHeight: lifetime.value.lastValidBlockHeight,
        summary: JSON.stringify(
          {
            step,
            cluster: "devnet",
            transactionVersion: message.version,
            computeUnitLimit,
            computeUnitPriceMicroLamports: "0",
            requiredSigners: Object.keys(transaction.signatures),
            feePayer: config.operator,
            collection: config.collection,
            collectionUri: config.collectionUri,
            registrationAuthority: config.registrationAuthority,
            verifierAuthority: config.verifierAuthority,
            custodyAuthority: config.custodyAuthority,
            treasury: config.treasury,
            paymentMint: config.paymentMint,
            feeRates: config.feeRates,
            legacyMarketplaceCommissionBps: step === "marketplace" ? 250 : undefined,
            legacyMarketplaceRoyaltyBps: step === "marketplace" ? 500 : undefined,
            testInspectionValidityDays: 30,
            sale,
            feeLamports: fee.value.toString(),
            simulationSlot: simulation.context.slot.toString(),
            unitsConsumed: simulation.value.unitsConsumed?.toString() ?? null,
            rent: "Additional account rent applies; this estimate is the network fee only",
            program: instruction.programAddress,
            accounts: instruction.accounts,
          },
          null,
          2,
        ),
      });
    },
    async approve(
      prepared: DevnetBootstrapPrepared,
      onSigned: (value: string) => void,
    ) {
      let stage: ApprovalStage = "wallet connection";
      try {
        const actor = connected();
        if (
          actor.wallet !== prepared.wallet ||
          actor.account.address !== prepared.config.operator
        )
          throw new Error("Wallet changed; prepare again");
        stage = "network and expiry checks";
        await checkNetwork();
        if (
          (await rpc
            .getBlockHeight({ commitment: "confirmed" })
            .send({ abortSignal: signal() })) > prepared.lastValidBlockHeight
        )
          throw new Error("Unsigned review expired; prepare again");
        stage = "account prerequisites";
        const current = await prepareDevnetBootstrapInstruction(
          prepared.step,
          prepared.config,
          read,
          prepared.sale,
        );
        if (instructionKey(current) !== prepared.instructionKey)
          throw new Error("Bootstrap intent changed");
        stage = "repeat simulation";
        await simulate(prepared.transaction);
        const partial = prepared.collectionSigner
          ? await partiallySignTransactionWithSigners(
              [prepared.collectionSigner],
              prepared.transaction,
            )
          : prepared.transaction;
        // The wallet is the sole operator/fee payer; collection creation additionally
        // uses a fresh temporary Devnet account signer retained only in this tab.
        const signer = actor.signer;
        if (!signer || !isTransactionModifyingSigner(signer))
          throw new Error("Wallet cannot sign separately");
        // Block height is still checked after signing and before broadcast.
        stage = "wallet signing";
        const [signed] = await signer
          .modifyAndSignTransactions([partial], {
            abortSignal: signal(),
          })
          .catch(() => {
            throw new Error(
              "Wallet signing did not complete. Check the selected wallet and approve within 20 seconds; no transaction was submitted.",
            );
          });
        if (!signed) throw new Error("Wallet did not return a transaction");
        stage = "signed message validation";
        assertUnmodifiedBootstrapMessage(
          prepared.transaction.messageBytes,
          signed.messageBytes,
        );
        const after = connected();
        if (
          after.wallet !== actor.wallet ||
          after.account.address !== actor.account.address
        )
          throw new Error("Wallet changed during approval");
        stage = "signature validation";
        const required = Object.keys(prepared.transaction.signatures);
        if (Object.keys(signed.signatures).length !== required.length)
          throw new Error("Wallet changed required signers");
        for (const key of required) {
          const bytes = signed.signatures[address(key)];
          if (
            !bytes ||
            !(await verifyWalletSignature(
              key,
              Uint8Array.from(signed.messageBytes),
              Uint8Array.from(bytes),
            ))
          )
            throw new Error("Bootstrap signature did not match the approved message");
        }
        stage = "signature retention";
        const retained = getSignatureFromTransaction(signed);
        onSigned(retained); // Retain before broadcast; unknown results cannot initiate replacement sends.
        stage = "submission";
        await checkNetwork();
        if (
          (await rpc
            .getBlockHeight({ commitment: "confirmed" })
            .send({ abortSignal: signal() })) > prepared.lastValidBlockHeight
        )
          throw new Error(
            "Signed transaction expired; reconcile its retained signature before retrying",
          );
        const sent = await rpc
          .sendTransaction(getBase64EncodedWireTransaction(signed), {
            encoding: "base64",
            skipPreflight: false,
            preflightCommitment: "confirmed",
            maxRetries: 3n,
          })
          .send({ abortSignal: signal() });
        if (sent !== retained)
          throw new Error("Submission returned a different signature");
        return retained;
      } catch (error) {
        if (error instanceof Error && publicApprovalErrors.has(error.message))
          throw error;
        throw new BootstrapApprovalError(stage);
      }
    },
    async check(retained: string) {
      await checkNetwork();
      const result = await rpc
        .getSignatureStatuses([signature(retained)], { searchTransactionHistory: true })
        .send({ abortSignal: signal() });
      const status = result.value[0];
      if (status?.confirmationStatus !== "finalized") return "UNKNOWN" as const;
      return status.err ? ("FAILED" as const) : ("FINALIZED" as const);
    },
  };
}
