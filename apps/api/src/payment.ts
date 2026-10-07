import type {
  WalletTransactionVersion,
  PaymentArtworkState,
  PaymentPurchaseInput,
  PaymentPreparation,
  MarketplacePaymentSettlement,
} from "@katha/solana";
import { PaymentValidationError, OperationSimulationError } from "@katha/solana";
import type { WalletSessionBoundary } from "./wallet-session.js";
import { DomainError } from "./errors.js";

export type AuthenticatedPaymentPreparation = PaymentPreparation & { walletId: string };
export interface PaymentProvider {
  readonly description: {
    kind: "DEVNET_TEST_TOKEN";
    cluster: "localnet" | "devnet";
    paymentMint: string;
    decimals: 6;
    simulation: true;
  };
  prepare(
    bearer: string | undefined,
    state: PaymentArtworkState,
    input: PaymentPurchaseInput,
    versions: ReadonlySet<WalletTransactionVersion>,
  ): Promise<AuthenticatedPaymentPreparation>;
  /** Preparation must come from trusted server persistence, never the request body. */
  verify(
    bearer: string | undefined,
    prepared: AuthenticatedPaymentPreparation,
    signedWire: string,
  ): Promise<
    | { status: "UNKNOWN" }
    | { status: "FAILED"; failureCode: "TRANSACTION_FAILED" }
    | { status: "FINALIZED"; slot: string; chainRecordedAt: string }
  >;
}
export function createDevnetPaymentProvider(
  sessions: Pick<WalletSessionBoundary, "authenticate">,
  settlement: MarketplacePaymentSettlement,
): PaymentProvider {
  const { cluster, paymentMint } = settlement.config;
  return {
    description: Object.freeze({
      kind: "DEVNET_TEST_TOKEN",
      cluster,
      paymentMint,
      decimals: 6,
      simulation: true,
    }),
    async prepare(bearer, state, input, versions) {
      const session = await sessions.authenticate(bearer);
      if (session.cluster !== cluster) throw new DomainError("FORBIDDEN");
      try {
        const prepared = await settlement.prepare(
          session.walletAddress,
          versions,
          state,
          input,
        );
        return { ...prepared, walletId: session.walletId };
      } catch (error) {
        if (
          error instanceof TypeError ||
          error instanceof PaymentValidationError ||
          (error instanceof OperationSimulationError && error.code === "REJECTED")
        )
          throw new DomainError("CONFLICT");
        throw new Error("Payment preparation unavailable", { cause: error });
      }
    },
    async verify(bearer, prepared, signedWire) {
      const session = await sessions.authenticate(bearer);
      if (
        session.cluster !== cluster ||
        prepared.walletId !== session.walletId ||
        prepared.buyer !== session.walletAddress
      )
        throw new DomainError("FORBIDDEN");
      let receipt;
      try {
        receipt = await settlement.verify(session.walletAddress, prepared, signedWire);
      } catch {
        throw new DomainError("CONFLICT");
      }
      if (receipt.status !== "FINALIZED") return receipt;
      return {
        status: "FINALIZED",
        slot: receipt.slot.toString(),
        chainRecordedAt: receipt.chainRecordedAt.toISOString(),
      };
    },
  };
}
